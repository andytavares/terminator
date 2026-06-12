import type { FastifyInstance } from 'fastify'
import { listWorkspaces, listProjects } from '../../storage/workspace-store.js'

export async function registerWorkspaceRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/workspaces', async () => listWorkspaces())

  app.get<{ Querystring: { workspaceId?: string } }>('/api/projects', async (request, reply) => {
    const { workspaceId } = request.query
    if (!workspaceId) {
      return reply.status(400).send({ error: 'VALIDATION_ERROR', message: 'workspaceId required' })
    }
    return listProjects(workspaceId)
  })
}
