import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { createServer, type AddressInfo, type Server } from 'net'
import { createRemoteServer } from '../../src/server/remote-server'
import { PortInUseError } from '../../src/server/port-in-use-error'
import { createFakePtyManager } from '../unit/helpers/fake-pty-manager'

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

type RemoteServer = Awaited<ReturnType<typeof createRemoteServer>>

let remoteServer: RemoteServer

function fakeDeps(onPortInUse = vi.fn()) {
  return {
    getPasswordHash: () => '',
    getMaxSubscribers: () => 5,
    listWorkspaces: () => [],
    listProjects: () => [],
    invokeChannel: vi.fn().mockResolvedValue(undefined),
    sendChannel: vi.fn(),
    onWindowEvent: vi.fn().mockReturnValue(vi.fn()),
    isRemoteAccessible: async () => true,
    onPortInUse,
  }
}

function createServerOnPort(port: number, onPortInUse = vi.fn()): Promise<RemoteServer> {
  return createRemoteServer({
    port,
    appPath: '/mock/app',
    ptyManager: createFakePtyManager() as never,
    deps: fakeDeps(onPortInUse),
  })
}

beforeEach(async () => {
  remoteServer = await createServerOnPort(ANY_PORT)
  await remoteServer.start()
})

afterEach(async () => {
  await remoteServer.stop()
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
    const conflictServer = await createServerOnPort(taken.port)
    await expect(conflictServer.start()).rejects.toThrow(PortInUseError)
  })

  it('start() with port in use calls onPortInUse', async () => {
    const onPortInUse = vi.fn()
    const conflictServer = await createServerOnPort(taken.port, onPortInUse)
    await conflictServer.start().catch(() => {})
    expect(onPortInUse).toHaveBeenCalledWith(taken.port)
  })

  it('start() rethrows a listen failure other than a port in use', async () => {
    const onPortInUse = vi.fn()
    const invalidPortServer = await createServerOnPort(-1, onPortInUse)
    await expect(invalidPortServer.start()).rejects.toThrow()
    expect(onPortInUse).not.toHaveBeenCalled()
  })
})
