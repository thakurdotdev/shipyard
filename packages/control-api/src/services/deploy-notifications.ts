import { eq } from 'drizzle-orm';
import { db } from '../db';
import { builds, projects } from '../db/schema';
import { NotificationService, type NotificationEvent } from './notification-service';

/** Turns build and deployment events into notifications. Never throws or blocks. */

function commitLine(build: { commit_sha: string | null; commit_message: string | null }) {
  const sha = build.commit_sha?.slice(0, 7);
  const message = build.commit_message?.split('\n')[0]?.slice(0, 80);
  if (sha && message) return `${sha} · ${message}`;
  return sha ?? 'Manual deploy';
}

async function send(buildId: string, event: NotificationEvent, detail?: string) {
  const [row] = await db
    .select({ build: builds, project: projects })
    .from(builds)
    .innerJoin(projects, eq(builds.project_id, projects.id))
    .where(eq(builds.id, buildId))
    .limit(1);
  if (!row) return;
  const { build, project } = row;
  const commit = commitLine(build);
  const where = project.domain ? `\n${project.domain}` : '';
  const messages: Partial<Record<NotificationEvent, { title: string; body: string }>> = {
    deploy_started: { title: `🔨 ${project.name} is building`, body: commit },
    deploy_succeeded: { title: `✅ ${project.name} is live`, body: `${commit}${where}` },
    deploy_failed: {
      title: `❌ ${project.name} ${detail === 'build' ? 'build failed' : 'deployment failed'}`,
      body: detail && detail !== 'build' ? `${commit}\n${detail.slice(0, 160)}` : commit,
    },
  };
  const text = messages[event];
  if (!text) return;
  await NotificationService.notify({
    event,
    projectId: project.id,
    title: text.title,
    body: text.body,
    url: `/projects/${project.id}?tab=deployments`,
    // One notification per build on the device: later states replace earlier ones.
    tag: `build-${build.id}`,
  });
}

export const DeployNotifications = {
  started(buildId: string) {
    void send(buildId, 'deploy_started').catch(() => {});
  },
  buildFailed(buildId: string) {
    void send(buildId, 'deploy_failed', 'build').catch(() => {});
  },
  live(buildId: string) {
    void send(buildId, 'deploy_succeeded').catch(() => {});
  },
  deployFailed(buildId: string, reason: string) {
    void send(buildId, 'deploy_failed', reason || 'Deployment failed').catch(() => {});
  },
};
