import { eq } from 'drizzle-orm';
import { db } from '../db';
import { projectAccess, projects } from '../db/schema';
import {
  DEFAULT_SESSION_HOURS,
  MAX_PASSWORD_LENGTH,
  MAX_SESSION_HOURS,
  MIN_PASSWORD_LENGTH,
  MIN_SESSION_HOURS,
  monitorToken,
} from './gate-session';

const IS_PLATFORM_PROD =
  process.env.NODE_ENV === 'production' || process.env.PLATFORM_ENV === 'production';
const DEPLOY_ENGINE_URL = process.env.DEPLOY_ENGINE_URL || 'http://localhost:4012';
const BASE_DOMAIN = process.env.BASE_DOMAIN || 'thakur.dev';

export interface GateRecord {
  projectId: string;
  projectName: string;
  enabled: boolean;
  passwordHash: string | null;
  sessionHours: number;
}

export interface AccessSettings {
  enabled: boolean;
  has_password: boolean;
  session_hours: number;
  /** False outside production, where no reverse proxy sits in front of the app. */
  enforced: boolean;
  domain: string | null;
}

export interface AccessUpdate {
  enabled?: boolean;
  password?: string;
  session_hours?: number;
}

// Nginx asks the gate about every request to a protected site, so lookups are cached briefly.
// Settings changes drop the entry, so this only delays changes made by another process.
const CACHE_TTL_MS = 5_000;
const hostCache = new Map<string, { at: number; record: GateRecord | null }>();

export class GateError extends Error {}

export const GateService = {
  isEnforced: IS_PLATFORM_PROD,

  invalidate() {
    hostCache.clear();
  },

  async findByHost(host: string): Promise<GateRecord | null> {
    const cached = hostCache.get(host);
    if (cached && Date.now() - cached.at < CACHE_TTL_MS) return cached.record;

    const [row] = await db
      .select({
        projectId: projects.id,
        projectName: projects.name,
        enabled: projectAccess.enabled,
        passwordHash: projectAccess.password_hash,
        sessionHours: projectAccess.session_hours,
      })
      .from(projects)
      .leftJoin(projectAccess, eq(projectAccess.project_id, projects.id))
      .where(eq(projects.domain, host))
      .limit(1);

    const record: GateRecord | null = row
      ? {
          projectId: row.projectId,
          projectName: row.projectName,
          enabled: row.enabled ?? false,
          passwordHash: row.passwordHash,
          sessionHours: row.sessionHours ?? DEFAULT_SESSION_HOURS,
        }
      : null;
    hostCache.set(host, { at: Date.now(), record });
    return record;
  },

  async isEnabled(projectId: string): Promise<boolean> {
    const row = await db.query.projectAccess.findFirst({
      where: eq(projectAccess.project_id, projectId),
      columns: { enabled: true, password_hash: true },
    });
    return !!row?.enabled && !!row.password_hash;
  },

  async getSettings(projectId: string): Promise<AccessSettings | null> {
    const project = await db.query.projects.findFirst({
      where: eq(projects.id, projectId),
      columns: { domain: true },
    });
    if (!project) return null;
    const row = await db.query.projectAccess.findFirst({
      where: eq(projectAccess.project_id, projectId),
    });
    return {
      enabled: row?.enabled ?? false,
      has_password: !!row?.password_hash,
      session_hours: row?.session_hours ?? DEFAULT_SESSION_HOURS,
      enforced: IS_PLATFORM_PROD,
      domain: project.domain,
    };
  },

  /** Headers that let ShipYard's uptime checks through the gate of the project's own domain. */
  async monitorHeaders(projectId: string, endpoint: string): Promise<Record<string, string>> {
    const row = await db.query.projectAccess.findFirst({
      where: eq(projectAccess.project_id, projectId),
      columns: { enabled: true, password_hash: true },
    });
    if (!row?.enabled || !row.password_hash) return {};
    const project = await db.query.projects.findFirst({
      where: eq(projects.id, projectId),
      columns: { domain: true },
    });
    let hostname: string;
    try {
      hostname = new URL(endpoint).hostname.toLowerCase();
    } catch {
      return {};
    }
    // Never hand the token to a third-party endpoint.
    if (!project?.domain || hostname !== project.domain.toLowerCase()) return {};
    return { 'X-Shipyard-Gate-Monitor': monitorToken(projectId, row.password_hash) };
  },

  /** Throws a GateError when a password or session length is out of bounds. */
  validate(update: AccessUpdate) {
    const password = update.password;
    if (password !== undefined) {
      if (password.length < MIN_PASSWORD_LENGTH) {
        throw new GateError(`Password must be at least ${MIN_PASSWORD_LENGTH} characters`);
      }
      if (password.length > MAX_PASSWORD_LENGTH) {
        throw new GateError(`Password must be at most ${MAX_PASSWORD_LENGTH} characters`);
      }
    }
    if (
      update.session_hours !== undefined &&
      (!Number.isInteger(update.session_hours) ||
        update.session_hours < MIN_SESSION_HOURS ||
        update.session_hours > MAX_SESSION_HOURS)
    ) {
      throw new GateError(
        `Session length must be between ${MIN_SESSION_HOURS} hour and ${MAX_SESSION_HOURS / 24} days`,
      );
    }
  },

  /**
   * Row for a project created with protection already on. Validates first, so the
   * caller can run this before creating anything.
   */
  async initialAccessRow(password: string, sessionHours?: number) {
    this.validate({ password, session_hours: sessionHours });
    return {
      enabled: true,
      password_hash: await Bun.password.hash(password, { algorithm: 'argon2id' }),
      session_hours: sessionHours ?? DEFAULT_SESSION_HOURS,
    };
  },

  async updateSettings(projectId: string, update: AccessUpdate): Promise<AccessSettings> {
    this.validate(update);
    const existing = await db.query.projectAccess.findFirst({
      where: eq(projectAccess.project_id, projectId),
    });

    const password = update.password;
    const passwordHash = password
      ? await Bun.password.hash(password, { algorithm: 'argon2id' })
      : (existing?.password_hash ?? null);
    const enabled = update.enabled ?? existing?.enabled ?? false;
    if (enabled && !passwordHash) {
      throw new GateError('Set a password before turning on protection');
    }

    const values = {
      enabled,
      password_hash: passwordHash,
      session_hours: update.session_hours ?? existing?.session_hours ?? DEFAULT_SESSION_HOURS,
      updated_at: new Date(),
    };
    await db
      .insert(projectAccess)
      .values({ project_id: projectId, ...values })
      .onConflictDoUpdate({ target: projectAccess.project_id, set: values });
    this.invalidate();

    return (await this.getSettings(projectId))!;
  },

  /** Restore a previous row after the proxy could not be updated. */
  async restore(projectId: string, previous: typeof projectAccess.$inferSelect | undefined) {
    if (previous) {
      await db
        .update(projectAccess)
        .set({
          enabled: previous.enabled,
          password_hash: previous.password_hash,
          session_hours: previous.session_hours,
          updated_at: new Date(),
        })
        .where(eq(projectAccess.project_id, projectId));
    } else {
      await db.delete(projectAccess).where(eq(projectAccess.project_id, projectId));
    }
    this.invalidate();
  },

  async snapshot(projectId: string) {
    return db.query.projectAccess.findFirst({ where: eq(projectAccess.project_id, projectId) });
  },

  /**
   * Make the reverse proxy match the stored setting for a live site. A project with
   * no live config yet needs nothing: the next activation reads the setting.
   */
  async applyToProxy(project: { domain: string | null; port: number | null }, gated: boolean) {
    if (!IS_PLATFORM_PROD || !project.domain?.endsWith(`.${BASE_DOMAIN}`)) return;
    const subdomain = project.domain.slice(0, -(BASE_DOMAIN.length + 1));
    const response = await fetch(`${DEPLOY_ENGINE_URL}/nginx/gate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ subdomain, port: project.port, gated }),
      signal: AbortSignal.timeout(30_000),
    });
    if (!response.ok) {
      throw new GateError(
        `Could not update the web server: ${(await response.text()).slice(0, 300)}`,
      );
    }
  },
};
