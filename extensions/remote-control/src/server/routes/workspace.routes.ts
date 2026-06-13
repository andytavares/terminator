import type { FastifyInstance } from 'fastify'
import type { WorkspaceSnapshot, ProjectSnapshot } from '../../types.js'

interface WorkspaceRouteDeps {
  listWorkspaces: () => WorkspaceSnapshot[]
  listProjects: (workspaceId: string) => ProjectSnapshot[]
}

export async function registerWorkspaceRoutes(
  app: FastifyInstance,
  deps: WorkspaceRouteDeps
): Promise<void> {
  app.get('/api/workspaces', async () => deps.listWorkspaces())

  app.get<{ Querystring: { workspaceId?: string } }>('/api/projects', async (request, reply) => {
    const { workspaceId } = request.query
    if (!workspaceId) {
      return reply.status(400).send({ error: 'VALIDATION_ERROR', message: 'workspaceId required' })
    }
    return deps.listProjects(workspaceId)
  })
}
