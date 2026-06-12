import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import Fastify from 'fastify'
import type { FastifyInstance } from 'fastify'
import { registerWorkspaceRoutes } from '../routes/workspace.routes'

vi.mock('../../storage/workspace-store.js', () => ({
  listWorkspaces: vi.fn(),
  listProjects: vi.fn(),
}))

import * as workspaceStore from '../../storage/workspace-store.js'
const mockListWorkspaces = vi.mocked(workspaceStore.listWorkspaces)
const mockListProjects = vi.mocked(workspaceStore.listProjects)

let app: FastifyInstance

beforeEach(async () => {
  vi.resetAllMocks()
  app = Fastify({ logger: false })
  await registerWorkspaceRoutes(app)
  await app.ready()
})

afterEach(async () => {
  await app.close()
})

describe('GET /api/workspaces', () => {
  it('returns workspace list', async () => {
    mockListWorkspaces.mockReturnValue([
      { id: 'ws1', name: 'My Workspace', folderPath: '/home/user', color: '#fff', tags: [] },
    ])
    const res = await app.inject({ method: 'GET', url: '/api/workspaces' })
    expect(res.statusCode).toBe(200)
    const body = JSON.parse(res.body)
    expect(body).toHaveLength(1)
    expect(body[0].name).toBe('My Workspace')
  })
})

describe('GET /api/projects', () => {
  it('returns projects for a workspace', async () => {
    mockListProjects.mockReturnValue([
      { id: 'p1', workspaceId: 'ws1', name: 'Project A', isWorktree: false },
    ])
    const res = await app.inject({ method: 'GET', url: '/api/projects?workspaceId=ws1' })
    expect(res.statusCode).toBe(200)
    const body = JSON.parse(res.body)
    expect(body).toHaveLength(1)
    expect(body[0].name).toBe('Project A')
  })

  it('returns 400 when workspaceId missing', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/projects' })
    expect(res.statusCode).toBe(400)
  })
})
