import { config } from '@thakur-deploy/config';
import { Elysia, t } from 'elysia';
import { CloudflareService } from '../services/cloudflare-service';
import { DomainService } from '../services/domain-service';
import { db } from '../db';
import { projects, builds, deployments } from '../db/schema';
import { eq, and, desc } from 'drizzle-orm';
import { ProjectAccessService } from '../services/project-access-service';
import { servesStaticFiles } from '../config/framework-config';
import { domainAliases, siteNameFor } from '../services/domain-names';
import { EventStreamService } from '../services/event-stream-service';
import { DeploymentService } from '../services/deployment-service';
import { DomainChangeService } from '../services/domain-change-service';

export const domainsRoutes = new Elysia({ prefix: '/domains' })
  /** What moving a project to this domain would do (DNS, takeover), changing nothing. */
  .get(
    '/project/:projectId/check',
    async ({ params: { projectId }, query, request, set }) => {
      const project = await ProjectAccessService.getOwnedProject(request, projectId);
      if (!project) {
        set.status = 404;
        return { error: 'Project not found' };
      }
      try {
        return await DomainChangeService.check(project, query.domain, query.www === 'true');
      } catch (error: any) {
        set.status = 502;
        return { error: error.message };
      }
    },
    {
      query: t.Object({
        domain: t.String({ minLength: 1, maxLength: 300 }),
        www: t.Optional(t.String()),
      }),
    },
  )
  /** Moves a project to a subdomain or a custom domain. Runs in the background. */
  .put(
    '/project/:projectId',
    async ({ params: { projectId }, body, request, set }) => {
      const project = await ProjectAccessService.getOwnedProject(request, projectId);
      if (!project) {
        set.status = 404;
        return { error: 'Project not found' };
      }
      try {
        const result = await DomainChangeService.start(
          project,
          body.domain,
          body.www_redirect ?? false,
        );
        set.status = result.started ? 202 : 200;
        return result;
      } catch (error: any) {
        set.status = 400;
        return { error: error.message };
      }
    },
    {
      body: t.Object({
        domain: t.String({ minLength: 1, maxLength: 300 }),
        www_redirect: t.Optional(t.Boolean()),
      }),
    },
  )
  .get('/project/:projectId/switch', async ({ params: { projectId }, request, set }) => {
    if (!(await ProjectAccessService.getOwnedProject(request, projectId))) {
      set.status = 404;
      return { error: 'Project not found' };
    }
    return { switch: DomainChangeService.getSwitch(projectId) };
  })
  .get(
    '/check',
    async ({ query }) => {
      const { subdomain } = query;
      try {
        const BASE_DOMAIN = config.baseDomain;
        const fullDomain = `${subdomain}.${BASE_DOMAIN}`;

        // 1. Check DB first
        const existingProject = await db
          .select()
          .from(projects)
          .where(eq(projects.domain, fullDomain));

        if (existingProject.length > 0) {
          return { available: false };
        }

        // 2. Fallback to Cloudflare
        const isAvailable = await CloudflareService.checkSubdomain(subdomain);
        return { available: isAvailable };
      } catch (error: any) {
        return new Response(JSON.stringify({ error: error.message }), {
          status: 400,
          headers: { 'Content-Type': 'application/json' },
        });
      }
    },
    {
      query: t.Object({
        subdomain: t.String({ minLength: 1 }),
      }),
    },
  )
  /**
   * Get domain provision status for a project.
   * Returns DNS status, SSL status, error messages, and cert expiry.
   */
  .get('/status/:projectId', async ({ params: { projectId }, request, set }) => {
    try {
      if (!(await ProjectAccessService.getOwnedProject(request, projectId))) {
        set.status = 404;
        return { error: 'Project not found' };
      }
      const provision = await DomainService.getByProjectId(projectId);

      if (!provision) {
        return {
          provisioned: false,
          dns_status: 'pending',
          ssl_status: 'pending',
        };
      }

      return {
        provisioned: true,
        id: provision.id,
        subdomain: provision.subdomain,
        full_domain: provision.full_domain,
        dns_status: provision.dns_status,
        dns_record_id: provision.dns_record_id,
        ssl_status: provision.ssl_status,
        ssl_cert_path: provision.ssl_cert_path,
        ssl_expiry: provision.ssl_expiry,
        server_ip: provision.server_ip,
        error_message: provision.error_message,
        created_at: provision.created_at,
        updated_at: provision.updated_at,
      };
    } catch (error: any) {
      set.status = 500;
      return { error: error.message };
    }
  })
  /**
   * Manually trigger domain provisioning for a project.
   * Useful for setting up domains before the first deployment.
   */
  .post('/provision/:projectId', async ({ params: { projectId }, request, set }) => {
    try {
      const project = await ProjectAccessService.getOwnedProject(request, projectId);

      if (!project) {
        set.status = 404;
        return { error: 'Project not found' };
      }

      if (!project.domain) {
        set.status = 400;
        return { error: 'Project has no domain assigned' };
      }

      if (!project.port && !servesStaticFiles(project)) {
        set.status = 400;
        return { error: 'Project has no port assigned' };
      }

      const subdomain = siteNameFor(project.domain);

      const result = await DomainService.provision(
        projectId,
        subdomain,
        servesStaticFiles(project) ? null : project.port,
        async (step, message) => {
          EventStreamService.broadcastDomainStatus(projectId, {
            step,
            message,
            project_id: projectId,
          });
        },
        undefined,
        { aliases: domainAliases(project) },
      );

      if (!result.success) {
        set.status = 500;
        return { error: result.error, failedAtStep: result.failedAtStep };
      }

      return {
        success: true,
        provisionId: result.provisionId,
        fullDomain: result.fullDomain,
      };
    } catch (error: any) {
      set.status = 500;
      return { error: error.message };
    }
  })
  /**
   * Retry failed domain provisioning.
   * Re-runs from the failed step (skips already completed steps).
   */
  .post('/retry/:projectId', async ({ params: { projectId }, request, set }) => {
    try {
      const project = await ProjectAccessService.getOwnedProject(request, projectId);

      if (!project) {
        set.status = 404;
        return { error: 'Project not found' };
      }

      if (!project.port && !servesStaticFiles(project)) {
        set.status = 400;
        return { error: 'Project has no port assigned' };
      }

      const result = await DomainService.retry(
        projectId,
        servesStaticFiles(project) ? null : project.port,
        async (step, message) => {
          EventStreamService.broadcastDomainStatus(projectId, {
            step,
            message,
            project_id: projectId,
          });
        },
        domainAliases(project),
        project.domain ? siteNameFor(project.domain) : undefined,
      );

      if (!result.success) {
        set.status = 500;
        return { error: result.error, failedAtStep: result.failedAtStep };
      }

      // If domain provisioning succeeded, auto-activate the latest successful build if deployment was stuck or failed
      const latestSuccessBuild = await db.query.builds.findFirst({
        where: and(eq(builds.project_id, projectId), eq(builds.status, 'success')),
        orderBy: [desc(builds.created_at)],
      });

      if (latestSuccessBuild) {
        const activeDeployment = await db.query.deployments.findFirst({
          where: and(eq(deployments.project_id, projectId), eq(deployments.status, 'active')),
        });

        if (!activeDeployment) {
          console.log(
            `[DomainRetry] Domain provision retry succeeded. Automatically activating latest successful build ${latestSuccessBuild.id}`,
          );
          DeploymentService.activateBuild(projectId, latestSuccessBuild.id).catch((e) => {
            console.error(`[DomainRetry] Auto-activation after domain retry failed:`, e);
          });
        }
      }

      return {
        success: true,
        provisionId: result.provisionId,
        fullDomain: result.fullDomain,
      };
    } catch (error: any) {
      set.status = 500;
      return { error: error.message };
    }
  });
