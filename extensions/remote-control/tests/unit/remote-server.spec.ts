import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { readFileSync, readdirSync, existsSync } from 'fs'
import { hashPassword } from '../../src/server/password-hash'

const PASSWORD = 'correct-password'

vi.mock('fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('fs')>()
  return {
    ...actual,
    readFileSync: vi.fn(actual.readFileSync),
    existsSync: vi.fn(() => false),
    readdirSync: vi.fn(actual.readdirSync),
  }
})

const mockTicketStore = vi.hoisted(() => ({
  createTicket: vi.fn(() => 'a'.repeat(64)),
  consumeTicket: vi.fn(() => null as string | null),
  startCleanup: vi.fn(),
  stopCleanup: vi.fn(),
}))

vi.mock('../../src/server/ws-ticket-store', () => ({
  WsTicketStore: vi.fn().mockImplementation(function () {
    return mockTicketStore
  }),
}))

const mockSubscriberManager = vi.hoisted(() => ({
  addSubscriber: vi.fn(),
  removeSubscriber: vi.fn(),
  broadcast: vi.fn(),
  destroySession: vi.fn(),
  destroyAll: vi.fn(),
  isPrimary: vi.fn(),
  getPrimary: vi.fn(),
  getCount: vi.fn(() => 0),
}))

vi.mock('../../src/server/ws-subscriber-manager', () => ({
  WsSubscriberManager: vi.fn(function () {
    return mockSubscriberManager
  }),
}))

type RemoteServer = Awaited<
  ReturnType<typeof import('../../src/server/remote-server').createRemoteServer>
>

let remoteServer: RemoteServer

// Minimal stateful fake of the v1.4.0 session-authority PtyManagerAPI
const ptySessions = new Map<string, Record<string, unknown>>()
const mockPtyManager = {
  spawnSession: vi.fn(
    async (opts: { sessionId: string; cwd: string; type: string; origin: string }) => {
      const info = { ...opts, createdAt: new Date().toISOString(), pid: 1 }
      ptySessions.set(opts.sessionId, info)
      return { ...info }
    }
  ),
  onData: vi.fn(() => () => {}),
  onExit: vi.fn(() => () => {}),
  getSession: vi.fn(async (id: string) => ptySessions.get(id)),
  setWorkspace: vi.fn(async (id: string, ws: string | null) => {
    const info = ptySessions.get(id)
    if (!info) return false
    info.workspaceId = ws ?? undefined
    return true
  }),
  write: vi.fn(),
  kill: vi.fn((id: string) => {
    ptySessions.delete(id)
  }),
  resize: vi.fn(),
  listSessions: vi.fn(async () => [...ptySessions.values()]),
}

const mockDeps = {
  getPasswordHash: vi.fn(() => ''),
  getMaxSubscribers: vi.fn(() => 5),
  listWorkspaces: vi.fn(() => []),
  listProjects: vi.fn(() => []),
  invokeChannel: vi.fn().mockResolvedValue(undefined),
  sendChannel: vi.fn(),
  onWindowEvent: vi.fn().mockReturnValue(vi.fn()),
  isRemoteAccessible: vi.fn().mockReturnValue(true),
  onPortInUse: vi.fn(),
}

async function createServerOnPort(port: number, deps = mockDeps): Promise<RemoteServer> {
  const { createRemoteServer } = await import('../../src/server/remote-server')
  return createRemoteServer({
    port,
    appPath: '/mock/app',
    ptyManager: mockPtyManager as never,
    deps,
  })
}

async function loginCookie(): Promise<string> {
  const res = await remoteServer.inject({
    method: 'POST',
    url: '/api/login',
    payload: { password: PASSWORD },
  })
  return String(res.headers['set-cookie']).split(';')[0]
}

/** The `name=token` pair a valid surface ticket sets, for a later request's cookie. */
async function surfaceSessionCookie(surface: 'app' | 'mobile'): Promise<string> {
  vi.mocked(readFileSync).mockReturnValueOnce('<html><head></head></html>')
  mockTicketStore.consumeTicket.mockReturnValueOnce(`__${surface}__`)
  const ticketResp = await remoteServer.inject({
    method: 'GET',
    url: `/${surface}/?t=valid-ticket`,
  })
  const setCookie = ticketResp.headers['set-cookie'] as string | string[]
  const cookieStr = Array.isArray(setCookie) ? setCookie[0] : (setCookie ?? '')
  return cookieStr.split(';')[0]
}

function allSetCookies(response: { headers: Record<string, unknown> }): string {
  const setCookie = response.headers['set-cookie'] as string | string[]
  return Array.isArray(setCookie) ? setCookie.join('; ') : (setCookie ?? '')
}

function failNextRead(): void {
  vi.mocked(readFileSync).mockImplementationOnce(() => {
    throw new Error('ENOENT')
  })
}

function getWithCookie(url: string, cookie?: string) {
  return remoteServer.inject({ method: 'GET', url, headers: cookie ? { cookie } : {} })
}

beforeEach(async () => {
  const storedHash = await hashPassword(PASSWORD)
  mockDeps.getPasswordHash.mockReturnValue(storedHash)
  remoteServer = await createServerOnPort(7683)
  await remoteServer.start()
})

afterEach(async () => {
  await remoteServer.stop()
  ptySessions.clear()
  vi.resetModules()
  vi.clearAllMocks()
})

describe('RemoteServer health route', () => {
  it('GET /health returns 200 { ok: true }', async () => {
    const response = await remoteServer.inject({ method: 'GET', url: '/health' })
    expect(response.statusCode).toBe(200)
    expect(JSON.parse(response.body)).toEqual({ ok: true })
  })
})

describe('RemoteServer start/stop lifecycle', () => {
  it('server is listening after start()', () => {
    expect(remoteServer.isListening()).toBe(true)
  })

  it('stop() closes the server', async () => {
    await remoteServer.stop()
    expect(remoteServer.isListening()).toBe(false)
  })

  it('double stop() is safe', async () => {
    await remoteServer.stop()
    await expect(remoteServer.stop()).resolves.not.toThrow()
  })
})

describe('RemoteServer disconnectAllClients', () => {
  it('disconnectAllClients() calls subscriberManager.destroyAll', () => {
    remoteServer.disconnectAllClients()
    expect(mockSubscriberManager.destroyAll).toHaveBeenCalled()
  })

  it('disconnectAllClients() kills remote PTY sessions', async () => {
    mockSubscriberManager.addSubscriber.mockReturnValueOnce(true)
    const createRes = await remoteServer.inject({
      method: 'POST',
      url: '/api/terminals',
      headers: { 'content-type': 'application/json', cookie: await loginCookie() },
      body: JSON.stringify({ cwd: '/tmp', type: 'human', tabTitle: 'test' }),
    })
    expect(createRes.statusCode).toBe(201)
    const { sessionId } = JSON.parse(createRes.body) as { sessionId: string }

    remoteServer.disconnectAllClients()
    await vi.waitFor(() => expect(mockPtyManager.kill).toHaveBeenCalledWith(sessionId))
  })
})

describe('RemoteServer GET /app/ without a ticket', () => {
  it('redirects to / when no ticket is provided', async () => {
    const response = await remoteServer.inject({ method: 'GET', url: '/app/' })
    expect(response.statusCode).toBe(302)
    expect(response.headers.location).toBe('/')
  })

  it('redirects to / when consumeTicket returns null (invalid/expired ticket)', async () => {
    mockTicketStore.consumeTicket.mockReturnValueOnce(null)
    const response = await remoteServer.inject({ method: 'GET', url: '/app/?t=bogus' })
    expect(response.statusCode).toBe(302)
    expect(response.headers.location).toBe('/')
  })
})

describe('RemoteServer GET /app/ with a ticket', () => {
  it('returns injected HTML and sets session cookie when ticket is valid', async () => {
    vi.mocked(readFileSync).mockReturnValueOnce('<html><head></head></html>')
    mockTicketStore.consumeTicket.mockReturnValueOnce('__app__')
    const response = await remoteServer.inject({ method: 'GET', url: '/app/?t=valid-ticket' })
    expect(response.statusCode).toBe(200)
    expect(response.headers['content-type']).toContain('text/html')
    expect(response.body).toContain('remote-shim.js')
    expect(allSetCookies(response)).toContain('app-session=')
    expect(allSetCookies(response)).toContain('HttpOnly')
  })

  it('serves app with existing valid session cookie (page refresh)', async () => {
    const token = await surfaceSessionCookie('app')
    vi.mocked(readFileSync).mockReturnValueOnce('<html><head></head></html>')
    const refreshResp = await getWithCookie('/app/', token)
    expect(refreshResp.statusCode).toBe(200)
    expect(refreshResp.body).toContain('remote-shim.js')
  })

  it('returns 503 when renderer is not built (valid ticket)', async () => {
    mockTicketStore.consumeTicket.mockReturnValueOnce('__app__')
    failNextRead()
    const response = await remoteServer.inject({ method: 'GET', url: '/app/?t=valid-ticket' })
    expect(response.statusCode).toBe(503)
  })
})

describe('RemoteServer /app/* static asset session gate', () => {
  it('returns 403 for /app/assets/* without a session cookie', async () => {
    const res = await getWithCookie('/app/assets/main.js')
    expect(res.statusCode).toBe(403)
  })

  it('returns 403 for /app/assets/* with an invalid session token', async () => {
    const res = await getWithCookie('/app/assets/main.js', 'app-session=bad-token')
    expect(res.statusCode).toBe(403)
  })

  it('allows /app/assets/* with a valid session cookie issued by ticket auth', async () => {
    const token = await surfaceSessionCookie('app')
    // The static file doesn't exist in test env so we get 404 (not 403)
    const assetResp = await getWithCookie('/app/assets/main.js', token)
    expect(assetResp.statusCode).not.toBe(403)
  })
})

describe('RemoteServer /app/* session gate after sessions end', () => {
  it('disconnectAllClients() clears app sessions, blocking subsequent asset requests', async () => {
    const token = await surfaceSessionCookie('app')
    remoteServer.disconnectAllClients()
    const assetResp = await getWithCookie('/app/assets/main.js', token)
    expect(assetResp.statusCode).toBe(403)
  })

  it('rejects /app/assets/* when session cookie has expired (server-side TTL)', async () => {
    vi.useFakeTimers()
    try {
      const token = await surfaceSessionCookie('app')
      // Advance time past 8-hour TTL
      vi.advanceTimersByTime(8 * 60 * 60 * 1000 + 1)
      const assetResp = await getWithCookie('/app/assets/main.js', token)
      expect(assetResp.statusCode).toBe(403)
    } finally {
      vi.useRealTimers()
    }
  })
})

function injectWorkspaces(headers: Record<string, string>) {
  return remoteServer.inject({ method: 'GET', url: '/api/workspaces', headers })
}

describe('RemoteServer login', () => {
  it('returns 401 for every login while no password hash is stored', async () => {
    mockDeps.getPasswordHash.mockReturnValue('')
    const res = await remoteServer.inject({
      method: 'POST',
      url: '/api/login',
      payload: { password: PASSWORD },
    })
    expect(res.statusCode).toBe(401)
  })

  it('does not accept the password as a Bearer header on an API request', async () => {
    const res = await injectWorkspaces({ Authorization: `Bearer ${PASSWORD}` })
    expect(res.statusCode).toBe(401)
  })
})

describe('RemoteServer login sessions', () => {
  it('authorises an API request with the cookie a correct login issued', async () => {
    const res = await injectWorkspaces({ cookie: await loginCookie() })
    expect(res.statusCode).toBe(200)
  })

  it('ends every login session when clients are disconnected (password change)', async () => {
    const cookie = await loginCookie()
    remoteServer.disconnectAllClients()
    const res = await injectWorkspaces({ cookie })
    expect(res.statusCode).toBe(401)
  })
})

describe('RemoteServer POST /api/mobile-ticket and /api/app-ticket', () => {
  it('returns 201 with a ticket when authenticated', async () => {
    const res = await remoteServer.inject({
      method: 'POST',
      url: '/api/mobile-ticket',
      headers: { cookie: await loginCookie() },
    })
    expect(res.statusCode).toBe(201)
    const body = JSON.parse(res.body) as { ticket: string }
    expect(typeof body.ticket).toBe('string')
    expect(body.ticket.length).toBeGreaterThan(0)
  })

  it('returns 401 without credentials', async () => {
    const res = await remoteServer.inject({ method: 'POST', url: '/api/mobile-ticket' })
    expect(res.statusCode).toBe(401)
  })

  it('issues an app ticket to an authenticated client', async () => {
    const cookie = await loginCookie()
    const res = await remoteServer.inject({
      method: 'POST',
      url: '/api/app-ticket',
      headers: { cookie },
    })
    expect(res.statusCode).toBe(201)
    expect(mockTicketStore.createTicket).toHaveBeenCalledWith('__app__', 'app')
  })
})

describe('RemoteServer GET /mobile/ without a ticket', () => {
  it('redirects to / when no ticket is provided', async () => {
    const res = await remoteServer.inject({ method: 'GET', url: '/mobile/' })
    expect(res.statusCode).toBe(302)
    expect(res.headers.location).toBe('/')
  })

  it('redirects to / when consumeTicket returns null (invalid/expired ticket)', async () => {
    mockTicketStore.consumeTicket.mockReturnValueOnce(null)
    const res = await remoteServer.inject({ method: 'GET', url: '/mobile/?t=bogus' })
    expect(res.statusCode).toBe(302)
    expect(res.headers.location).toBe('/')
  })
})

describe('RemoteServer GET /mobile/ with a ticket', () => {
  it('returns 200 and sets mobile-session cookie when ticket is valid', async () => {
    vi.mocked(readFileSync).mockReturnValueOnce('<html><head></head></html>')
    mockTicketStore.consumeTicket.mockReturnValueOnce('__mobile__')
    const res = await remoteServer.inject({ method: 'GET', url: '/mobile/?t=valid-ticket' })
    expect(res.statusCode).toBe(200)
    expect(res.headers['content-type']).toContain('text/html')
    expect(allSetCookies(res)).toContain('mobile-session=')
    expect(allSetCookies(res)).toContain('HttpOnly')
  })

  it('returns 503 when renderer is not built (valid ticket)', async () => {
    mockTicketStore.consumeTicket.mockReturnValueOnce('__mobile__')
    failNextRead()
    const res = await remoteServer.inject({ method: 'GET', url: '/mobile/?t=valid-ticket' })
    expect(res.statusCode).toBe(503)
  })
})

describe('RemoteServer /mobile/* static asset session gate', () => {
  it('returns 403 for /mobile/assets/* without a session cookie', async () => {
    const res = await getWithCookie('/mobile/assets/main.js')
    expect(res.statusCode).toBe(403)
  })

  it('returns 403 for /mobile/assets/* with an invalid session token', async () => {
    const res = await getWithCookie('/mobile/assets/main.js', 'mobile-session=bad-token')
    expect(res.statusCode).toBe(403)
  })

  it('allows /mobile/assets/* with a valid mobile-session cookie', async () => {
    const token = await surfaceSessionCookie('mobile')
    const assetResp = await getWithCookie('/mobile/assets/main.js', token)
    expect(assetResp.statusCode).not.toBe(403)
  })
})

const EXTENSION_ID = 'com.terminator.task-vault'
const EXT_ROOT = '/mock/app/extensions'
const EXT_DIR = `${EXT_ROOT}/task-vault`
const MANIFEST = JSON.stringify({ id: EXTENSION_ID, renderer: 'dist/index.html' })
const INDEX_HTML = '<html><head></head><body>task-vault</body></html>'

/** Simulate installed extensions, `task-vault` with a built renderer, in /mock/app. */
function mockInstalledExtensions(entries: string[], files: Record<string, string>): void {
  vi.mocked(existsSync).mockImplementation((p) => {
    const path = String(p)
    return path === EXT_ROOT || path in files || path === `${EXT_DIR}/dist`
  })
  vi.mocked(readdirSync).mockReturnValue(entries as unknown as ReturnType<typeof readdirSync>)
  vi.mocked(readFileSync).mockImplementation((p) => {
    const content = files[String(p)]
    if (content !== undefined) return content
    throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' })
  })
}

const BUILT_EXTENSION = {
  [`${EXT_DIR}/manifest.json`]: MANIFEST,
  [`${EXT_DIR}/dist/index.html`]: INDEX_HTML,
  '/mock/app/out/renderer/index.html': '<html><head></head></html>',
}

function restoreFs(): void {
  vi.mocked(existsSync).mockImplementation(() => false)
  vi.mocked(readdirSync).mockReset()
  vi.mocked(readFileSync).mockReset()
}

describe('RemoteServer /ext/* extension routes', () => {
  afterEach(restoreFs)

  it('GET /ext/<id>/ is publicly accessible (no session gate on extension statics)', async () => {
    mockInstalledExtensions(['task-vault'], BUILT_EXTENSION)
    const extServer = await createServerOnPort(7685)
    const res = await extServer.inject({ method: 'GET', url: `/ext/${EXTENSION_ID}/` })
    // No 403 — extension static assets have no session gate
    expect(res.statusCode).not.toBe(403)
  })

  it('GET /ext/<id>/ returns 200 with shim and base CSS injected when renderer is built', async () => {
    mockInstalledExtensions(['task-vault'], BUILT_EXTENSION)
    const extServer = await createServerOnPort(7685)
    const res = await extServer.inject({ method: 'GET', url: `/ext/${EXTENSION_ID}/` })
    expect(res.statusCode).toBe(200)
    expect(res.headers['content-type']).toContain('text/html')
    expect(res.body).toContain('remote-shim.js')
    expect(res.body).toContain('--tm-bg-base')
    expect(res.body).toContain('<head>')
  })
})

describe('RemoteServer /ext/* extensions without a renderer', () => {
  afterEach(restoreFs)

  it('GET /ext/<id>/ returns 503 when renderer is not built', async () => {
    // The extension's index.html is missing
    mockInstalledExtensions(['task-vault'], { [`${EXT_DIR}/manifest.json`]: MANIFEST })
    const extServer = await createServerOnPort(7685)
    const res = await extServer.inject({ method: 'GET', url: `/ext/${EXTENSION_ID}/` })
    expect(res.statusCode).toBe(503)
    expect(res.body).toContain(EXTENSION_ID)
  })
})

describe('RemoteServer /ext/* extensions it cannot serve', () => {
  afterEach(restoreFs)

  it('serves no route for an extension whose manifest is malformed, rendererless or unbuilt', async () => {
    mockInstalledExtensions(['broken', 'headless', 'unbuilt', 'bare'], {
      [`${EXT_ROOT}/broken/manifest.json`]: '{ not json',
      [`${EXT_ROOT}/headless/manifest.json`]: JSON.stringify({ id: 'com.headless' }),
      [`${EXT_ROOT}/unbuilt/manifest.json`]: JSON.stringify({
        id: 'com.unbuilt',
        renderer: 'dist/index.html',
      }),
    })
    const extServer = await createServerOnPort(7685)
    for (const id of ['com.headless', 'com.unbuilt']) {
      const res = await extServer.inject({ method: 'GET', url: `/ext/${id}/` })
      expect(res.statusCode).toBe(404)
    }
  })

  it('serves no extension routes when the extensions folder cannot be read', async () => {
    mockInstalledExtensions([], BUILT_EXTENSION)
    vi.mocked(readdirSync).mockImplementation(() => {
      throw new Error('EACCES')
    })
    const extServer = await createServerOnPort(7685)
    const res = await extServer.inject({ method: 'GET', url: `/ext/${EXTENSION_ID}/` })
    expect(res.statusCode).toBe(404)
  })
})

describe('RemoteServer EADDRINUSE handling', () => {
  it('start() with port in use rejects with PortInUseError', async () => {
    const { PortInUseError } = await import('../../src/server/remote-server')
    const conflictServer = await createServerOnPort(7683, { ...mockDeps, onPortInUse: vi.fn() })
    await expect(conflictServer.start()).rejects.toThrow(PortInUseError)
  })

  it('start() with port in use calls onPortInUse', async () => {
    const onPortInUse = vi.fn()
    const conflictServer = await createServerOnPort(7683, { ...mockDeps, onPortInUse })
    await conflictServer.start().catch(() => {})
    expect(onPortInUse).toHaveBeenCalledWith(7683)
  })

  it('start() rethrows a listen failure other than a port in use', async () => {
    const onPortInUse = vi.fn()
    const invalidPortServer = await createServerOnPort(-1, { ...mockDeps, onPortInUse })
    await expect(invalidPortServer.start()).rejects.toThrow()
    expect(onPortInUse).not.toHaveBeenCalled()
  })
})
