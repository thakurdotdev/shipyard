import { and, eq } from 'drizzle-orm';
import { auth } from '../lib/auth';
import { db } from '../db';
import { projects } from '../db/schema';

export const ProjectAccessService = {
  async userIdFromRequest(request: Request): Promise<string | null> {
    const session = await auth.api.getSession({ headers: request.headers });
    return session?.user.id ?? null;
  },

  async getOwnedProject(request: Request, projectId: string) {
    const userId = await this.userIdFromRequest(request);
    if (!userId) return null;

    return (
      (await db.query.projects.findFirst({
        where: and(eq(projects.id, projectId), eq(projects.owner_id, userId)),
      })) ?? null
    );
  },

  async ownsProject(request: Request, projectId: string): Promise<boolean> {
    return (await this.getOwnedProject(request, projectId)) !== null;
  },
};
