import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const mockFetch = vi.fn()
global.fetch = mockFetch

// jsdom provides sessionStorage — reset between tests
beforeEach(() => {
  sessionStorage.clear()
  mockFetch.mockReset()
})

afterEach(() => {
  vi.resetModules()
})

describe('remote-client token helpers', () => {
  it('setToken persists to sessionStorage and getToken returns it', async () => {
    const { setToken } = await import('../../../src/renderer-remote/api/remote-client')
    setToken('abc123')
    expect(sessionStorage.getItem('remote_token')).toBe('abc123')
  })

  it('clearToken removes the token from sessionStorage', async () => {
    const { setToken, clearToken } = await import('../../../src/renderer-remote/api/remote-client')
    setToken('abc123')
    clearToken()
    expect(sessionStorage.getItem('remote_token')).toBeNull()
  })
})

describe('createTerminal', () => {
  it('POST /api/terminals with cwd and tabTitle, returns sessionId', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ sessionId: 's1' }),
    })
    const { createTerminal } = await import('../../../src/renderer-remote/api/remote-client')
    const result = await createTerminal({ cwd: '/tmp', tabTitle: 'Test' })
    expect(result.sessionId).toBe('s1')
    expect(mockFetch).toHaveBeenCalledWith(
      '/api/terminals',
      expect.objectContaining({ method: 'POST' })
    )
  })

  it('throws when response is not ok', async () => {
    mockFetch.mockResolvedValueOnce({ ok: false, status: 500 })
    const { createTerminal } = await import('../../../src/renderer-remote/api/remote-client')
    await expect(createTerminal({ cwd: '/tmp' })).rejects.toThrow('createTerminal failed')
  })
})

describe('deleteTerminal', () => {
  it('DELETE /api/terminals/:sessionId', async () => {
    mockFetch.mockResolvedValueOnce({ ok: true })
    const { deleteTerminal } = await import('../../../src/renderer-remote/api/remote-client')
    await deleteTerminal('s1')
    expect(mockFetch).toHaveBeenCalledWith(
      '/api/terminals/s1',
      expect.objectContaining({ method: 'DELETE' })
    )
  })
})

describe('resizeTerminal', () => {
  it('POST /api/terminals/:sessionId/resize with cols and rows', async () => {
    mockFetch.mockResolvedValueOnce({ ok: true })
    const { resizeTerminal } = await import('../../../src/renderer-remote/api/remote-client')
    await resizeTerminal('s1', 120, 40)
    expect(mockFetch).toHaveBeenCalledWith(
      '/api/terminals/s1/resize',
      expect.objectContaining({ method: 'POST' })
    )
  })
})

describe('getWsTicket', () => {
  it('returns ticket string on success', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ ticket: 'ticket-abc' }),
    })
    const { getWsTicket } = await import('../../../src/renderer-remote/api/remote-client')
    const ticket = await getWsTicket('s1')
    expect(ticket).toBe('ticket-abc')
  })

  it('throws when response is not ok', async () => {
    mockFetch.mockResolvedValueOnce({ ok: false, status: 401 })
    const { getWsTicket } = await import('../../../src/renderer-remote/api/remote-client')
    await expect(getWsTicket('s1')).rejects.toThrow('getWsTicket failed')
  })
})

describe('listWorkspaces', () => {
  it('GET /api/workspaces returns workspace array', async () => {
    const workspaces = [
      { id: 'w1', name: 'My Workspace', folderPath: '/tmp', color: 'blue', tags: [] },
    ]
    mockFetch.mockResolvedValueOnce({ ok: true, json: async () => workspaces })
    const { listWorkspaces } = await import('../../../src/renderer-remote/api/remote-client')
    const result = await listWorkspaces()
    expect(result).toEqual(workspaces)
  })

  it('throws when response is not ok', async () => {
    mockFetch.mockResolvedValueOnce({ ok: false, status: 401 })
    const { listWorkspaces } = await import('../../../src/renderer-remote/api/remote-client')
    await expect(listWorkspaces()).rejects.toThrow('listWorkspaces failed')
  })
})

describe('listProjects', () => {
  it('GET /api/projects?workspaceId=... returns project array', async () => {
    const projects = [{ id: 'p1', workspaceId: 'w1', name: 'Project' }]
    mockFetch.mockResolvedValueOnce({ ok: true, json: async () => projects })
    const { listProjects } = await import('../../../src/renderer-remote/api/remote-client')
    const result = await listProjects('w1')
    expect(result).toEqual(projects)
    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining('workspaceId=w1'),
      expect.anything()
    )
  })

  it('throws when response is not ok', async () => {
    mockFetch.mockResolvedValueOnce({ ok: false, status: 403 })
    const { listProjects } = await import('../../../src/renderer-remote/api/remote-client')
    await expect(listProjects('w1')).rejects.toThrow('listProjects failed')
  })
})

describe('Authorization header', () => {
  it('includes Bearer token from sessionStorage in requests', async () => {
    const { setToken, listWorkspaces } = await import(
      '../../../src/renderer-remote/api/remote-client'
    )
    setToken('mytoken')
    mockFetch.mockResolvedValueOnce({ ok: true, json: async () => [] })
    await listWorkspaces()
    const [, options] = mockFetch.mock.calls[0] as [string, RequestInit]
    const headers = new Headers(options.headers)
    expect(headers.get('Authorization')).toBe('Bearer mytoken')
  })
})
