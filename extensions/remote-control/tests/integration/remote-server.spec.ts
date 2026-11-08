import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { createServer, type AddressInfo, type Server } from 'net'
import { hashPassword } from '../../src/server/password-hash'

const PASSWORD = 'correct-password'

// Every server here listens on a port the OS picks (0), never a fixed one: a fixed
// port is shared by every test run on the machine, so two runs at once (another
// checkout, CI shards) made start() fail with PortInUseError at random.
const ANY_PORT = 0

/** A port held by a plain TCP server on all interfaces, as the remote server binds. */
async function occupiedPort(): Promise<{ port: number; holder: Server }> {
  const holder = createServer()
  await new Promise<void>((resolve) => holder.listen(0, '0.0.0.0', resolve))
  return { port: (holder.address() as AddressInfo).port, holder }
}

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
  createTicket: vi.fn<(sessionId: string, purpose: string) => string>(),
  consumeTicket: vi.fn<(ticket: string, purpose: string) => string | null>(),
  startCleanup: vi.fn(),
  stopCleanup: vi.fn(),
}))

// Tickets are real unless a test answers consumeTicket itself; the cleanup timer stays off.
vi.mock('../../src/server/ws-ticket-store', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/server/ws-ticket-store')>()
  return {
    WsTicketStore: vi.fn().mockImplementation(function () {
      const real = new actual.WsTicketStore()
      mockTicketStore.createTicket.mockImplementation((id, purpose) =>
        real.createTicket(id, purpose)
      )
      mockTicketStore.consumeTicket.mockImplementation((ticket, purpose) =>
        real.consumeTicket(ticket, purpose)
      )
      return mockTicketStore
    }),
  }
})

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

beforeEach(async () => {
  const storedHash = await hashPassword(PASSWORD)
  mockDeps.getPasswordHash.mockReturnValue(storedHash)
  remoteServer = await createServerOnPort(ANY_PORT)
  await remoteServer.start()
})

afterEach(async () => {
  await remoteServer.stop()
  ptySessions.clear()
  vi.resetModules()
  vi.clearAllMocks()
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

describe('RemoteServer EADDRINUSE handling', () => {
  let taken: { port: number; holder: Server }

  beforeEach(async () => {
    taken = await occupiedPort()
  })

  afterEach(async () => {
    await new Promise((resolve) => taken.holder.close(resolve))
  })

  it('start() with port in use rejects with PortInUseError', async () => {
    const { PortInUseError } = await import('../../src/server/port-in-use-error')
    const conflictServer = await createServerOnPort(taken.port, {
      ...mockDeps,
      onPortInUse: vi.fn(),
    })
    await expect(conflictServer.start()).rejects.toThrow(PortInUseError)
  })

  it('start() with port in use calls onPortInUse', async () => {
    const onPortInUse = vi.fn()
    const conflictServer = await createServerOnPort(taken.port, { ...mockDeps, onPortInUse })
    await conflictServer.start().catch(() => {})
    expect(onPortInUse).toHaveBeenCalledWith(taken.port)
  })

  it('start() rethrows a listen failure other than a port in use', async () => {
    const onPortInUse = vi.fn()
    const invalidPortServer = await createServerOnPort(-1, { ...mockDeps, onPortInUse })
    await expect(invalidPortServer.start()).rejects.toThrow()
    expect(onPortInUse).not.toHaveBeenCalled()
  })
})
