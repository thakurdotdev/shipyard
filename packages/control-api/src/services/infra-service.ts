import { db } from '../db';
import { infrastructureServices, ServiceType, ServiceStatus, user } from '../db/schema';
import { eq, desc } from 'drizzle-orm';
import { createCipheriv, createDecipheriv, randomBytes } from 'crypto';
import {
  generateCredentials,
  generateConnectionUrl,
  RedisCredentials,
  PostgresCredentials,
} from '../utils/credential-generator';

const ALGORITHM = 'aes-256-gcm';
const ENCRYPTION_KEY = process.env.ENCRYPTION_KEY!;

// Port range for infrastructure services
const PORT_RANGE_START = 20000;
const PORT_RANGE_END = 25000;

// Server host for connection strings
const SERVER_HOST = process.env.SERVER_HOST || 'localhost';

// Deploy engine URL
const DEPLOY_ENGINE_URL = process.env.DEPLOY_ENGINE_URL || 'http://localhost:4002';

/**
 * Encrypt credentials for storage
 */
function encryptCredentials(creds: RedisCredentials | PostgresCredentials): string {
  const json = JSON.stringify(creds);
  const iv = randomBytes(12);
  const cipher = createCipheriv(ALGORITHM, ENCRYPTION_KEY, iv);
  let encrypted = cipher.update(json, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  const authTag = cipher.getAuthTag().toString('hex');
  return `${iv.toString('hex')}:${authTag}:${encrypted}`;
}

/**
 * Decrypt credentials from storage
 */
function decryptCredentials(text: string): RedisCredentials | PostgresCredentials {
  const [ivHex, authTagHex, encryptedHex] = text.split(':');
  const iv = Buffer.from(ivHex, 'hex');
  const authTag = Buffer.from(authTagHex, 'hex');
  const decipher = createDecipheriv(ALGORITHM, ENCRYPTION_KEY, iv);
  decipher.setAuthTag(authTag);
  let decrypted = decipher.update(encryptedHex, 'hex', 'utf8');
  decrypted += decipher.final('utf8');
  return JSON.parse(decrypted);
}

/**
 * Find next available port in range
 */
async function findAvailablePort(): Promise<number> {
  const usedPorts = await db
    .select({ port: infrastructureServices.port })
    .from(infrastructureServices);

  const usedSet = new Set(usedPorts.map((p) => p.port));

  for (let port = PORT_RANGE_START; port <= PORT_RANGE_END; port++) {
    if (!usedSet.has(port)) {
      return port;
    }
  }

  throw new Error('No available ports in range');
}

/**
 * Generate container name
 */
function generateContainerName(serviceType: ServiceType, name: string): string {
  const sanitized = name
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '-')
    .substring(0, 20);
  const suffix = randomBytes(4).toString('hex');
  return `infra-${serviceType}-${sanitized}-${suffix}`;
}

export const InfraService = {
  /**
   * Create a new infrastructure service
   */
  async create(data: {
    name: string;
    service_type: ServiceType;
    version?: string;
    bind_localhost?: boolean;
    created_by?: string;
  }) {
    const { name, service_type, version, bind_localhost = false, created_by } = data;

    // Generate unique port and container name
    const port = await findAvailablePort();
    const containerName = generateContainerName(service_type, name);

    // Generate credentials
    const credentials = generateCredentials(service_type, name);
    const encryptedCredentials = encryptCredentials(credentials);

    // Create database record
    const [service] = await db
      .insert(infrastructureServices)
      .values({
        name,
        service_type,
        container_name: containerName,
        host: SERVER_HOST,
        port,
        credentials: encryptedCredentials,
        status: 'starting',
        version: version || (service_type === 'redis' ? '7' : '16'),
        bind_localhost,
        created_by,
      })
      .returning();

    // Start container via deploy engine
    try {
      const res = await fetch(`${DEPLOY_ENGINE_URL}/infra/start`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          serviceId: service.id,
          serviceType: service_type,
          containerName,
          port,
          credentials,
          version: service.version,
          bindLocalhost: bind_localhost,
        }),
      });

      if (!res.ok) {
        const error = await res.text();
        // Update status to error
        await db
          .update(infrastructureServices)
          .set({ status: 'error' })
          .where(eq(infrastructureServices.id, service.id));
        throw new Error(`Failed to start container: ${error}`);
      }

      const result = (await res.json()) as { containerId?: string };

      // Update with container ID and running status
      await db
        .update(infrastructureServices)
        .set({
          container_id: result.containerId,
          status: 'running',
        })
        .where(eq(infrastructureServices.id, service.id));

      // Return service with connection URL
      return {
        ...service,
        status: 'running' as ServiceStatus,
        container_id: result.containerId,
        connection_url: generateConnectionUrl(service_type, SERVER_HOST, port, credentials),
      };
    } catch (error: any) {
      // Update status to error
      await db
        .update(infrastructureServices)
        .set({ status: 'error' })
        .where(eq(infrastructureServices.id, service.id));
      throw error;
    }
  },

  /**
   * Get all infrastructure services
   */
  async getAll() {
    const services = await db
      .select()
      .from(infrastructureServices)
      .orderBy(desc(infrastructureServices.created_at));

    return services.map((s) => ({
      ...s,
      credentials: undefined, // Don't expose encrypted credentials in list
    }));
  },

  /**
   * Get service by ID with connection URL
   */
  async getById(id: string) {
    const [service] = await db
      .select()
      .from(infrastructureServices)
      .where(eq(infrastructureServices.id, id));

    if (!service) return null;

    const credentials = decryptCredentials(service.credentials);
    const connectionUrl = generateConnectionUrl(
      service.service_type as ServiceType,
      service.host,
      service.port,
      credentials,
    );

    return {
      ...service,
      credentials,
      connection_url: connectionUrl,
    };
  },

  /**
   * Delete a service (stop container and remove)
   */
  async delete(id: string) {
    const [service] = await db
      .select()
      .from(infrastructureServices)
      .where(eq(infrastructureServices.id, id));

    if (!service) {
      throw new Error('Service not found');
    }

    // Stop container via deploy engine
    try {
      await fetch(`${DEPLOY_ENGINE_URL}/infra/stop`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          containerName: service.container_name,
          removeVolume: true, // Remove data volume too
        }),
      });
    } catch (error) {
      console.error(`[InfraService] Failed to stop container:`, error);
      // Continue with deletion even if container stop fails
    }

    // Delete from database
    await db.delete(infrastructureServices).where(eq(infrastructureServices.id, id));

    return { success: true };
  },

  /**
   * Restart a service
   */
  async restart(id: string) {
    const [service] = await db
      .select()
      .from(infrastructureServices)
      .where(eq(infrastructureServices.id, id));

    if (!service) {
      throw new Error('Service not found');
    }

    const credentials = decryptCredentials(service.credentials);

    // Update status to starting
    await db
      .update(infrastructureServices)
      .set({ status: 'starting' })
      .where(eq(infrastructureServices.id, id));

    try {
      // Stop existing container
      await fetch(`${DEPLOY_ENGINE_URL}/infra/stop`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          containerName: service.container_name,
          removeVolume: false, // Keep data
        }),
      });

      // Start container again
      const res = await fetch(`${DEPLOY_ENGINE_URL}/infra/start`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          serviceId: service.id,
          serviceType: service.service_type,
          containerName: service.container_name,
          port: service.port,
          credentials,
          version: service.version,
          bindLocalhost: service.bind_localhost,
        }),
      });

      if (!res.ok) {
        throw new Error('Failed to restart container');
      }

      const result = (await res.json()) as { containerId?: string };

      // Update status
      await db
        .update(infrastructureServices)
        .set({
          container_id: result.containerId,
          status: 'running',
          updated_at: new Date(),
        })
        .where(eq(infrastructureServices.id, id));

      return { success: true, status: 'running' };
    } catch (error: any) {
      await db
        .update(infrastructureServices)
        .set({ status: 'error' })
        .where(eq(infrastructureServices.id, id));
      throw error;
    }
  },

  /**
   * Get container logs
   */
  async getLogs(id: string, tail: number = 100) {
    const [service] = await db
      .select()
      .from(infrastructureServices)
      .where(eq(infrastructureServices.id, id));

    if (!service) {
      throw new Error('Service not found');
    }

    const res = await fetch(
      `${DEPLOY_ENGINE_URL}/infra/logs?containerName=${service.container_name}&tail=${tail}`,
    );

    if (!res.ok) {
      throw new Error('Failed to get logs');
    }

    const data = (await res.json()) as { logs: string };
    return data.logs;
  },

  /**
   * Update service status (called by deploy engine)
   */
  async updateStatus(id: string, status: ServiceStatus, containerId?: string) {
    const updateData: any = { status, updated_at: new Date() };
    if (containerId) updateData.container_id = containerId;

    await db
      .update(infrastructureServices)
      .set(updateData)
      .where(eq(infrastructureServices.id, id));
  },
};
