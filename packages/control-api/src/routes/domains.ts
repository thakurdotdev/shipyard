import { Elysia, t } from 'elysia';
import { CloudflareService } from '../services/cloudflare-service';
import { DomainService } from '../services/domain-service';
import { db } from '../db';
import { projects } from '../db/schema';
import { eq } from 'drizzle-orm';

export const domainsRoutes = new Elysia({ prefix: '/domains' })
  .get(
    '/check',
    async ({ query }) => {
      const { subdomain } = query;
      try {
        const BASE_DOMAIN = process.env.BASE_DOMAIN || 'thakur.dev';
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
  .get('/status/:projectId', async ({ params: { projectId }, set }) => {
    try {
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
  .post('/provision/:projectId', async ({ params: { projectId }, set }) => {
    try {
      const project = await db.query.projects.findFirst({
        where: eq(projects.id, projectId),
      });

      if (!project) {
        set.status = 404;
        return { error: 'Project not found' };
      }

      if (!project.domain) {
        set.status = 400;
        return { error: 'Project has no domain assigned' };
      }

      if (!project.port) {
        set.status = 400;
        return { error: 'Project has no port assigned' };
      }

      const subdomain = project.domain.split('.')[0];

      // Import WebSocket for status broadcasting
      const { WebSocketService } = await import('../ws');

      const result = await DomainService.provision(
        projectId,
        subdomain,
        project.port,
        async (step, message) => {
          WebSocketService.broadcastDomainStatus(projectId, {
            step,
            message,
            project_id: projectId,
          });
        },
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
  .post('/retry/:projectId', async ({ params: { projectId }, set }) => {
    try {
      const project = await db.query.projects.findFirst({
        where: eq(projects.id, projectId),
      });

      if (!project) {
        set.status = 404;
        return { error: 'Project not found' };
      }

      if (!project.port) {
        set.status = 400;
        return { error: 'Project has no port assigned' };
      }

      const { WebSocketService } = await import('../ws');

      const result = await DomainService.retry(projectId, project.port, async (step, message) => {
        WebSocketService.broadcastDomainStatus(projectId, {
          step,
          message,
          project_id: projectId,
        });
      });

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
  });
