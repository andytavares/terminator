import { describe, it, expect, beforeAll, vi } from 'vitest'
import { dispatchChannel, type ChannelSpec } from '@terminator/extension-sdk'
import { hashPassword } from '../../src/server/password-hash'

// The remote server and fastify cost the extension host 25 MB (docs/research/perf/
// 2026-10-12-extension-host.md). They load when Remote Control is turned on, not
// when the extension activates with it off, which is the default. Vitest runs a
// vi.mock factory when the module is first imported, so `loaded` records it.

const loaded = vi.hoisted(() => ({ server: false }))
const createRemoteServer = vi.hoisted(() => vi.fn())

vi.mock('../../src/server/remote-server', () => {
  loaded.server = true
  return { createRemoteServer }
})

const settings = new Map<string, unknown>()
const specs: ChannelSpec[] = []

function api() {
  return {
    settings: {
      register: vi.fn(),
      get: (key: string) => settings.get(key),
      set: (key: string, value: unknown) => settings.set(key, value),
    },
    ipc: { registerHandler: (spec: ChannelSpec) => specs.push(spec) },
    window: { broadcast: vi.fn() },
    paths: { app: '/app', globalStorage: '/user-data/extensions/terminator.remote-control' },
    pty: {},
    workspace: { list: () => [], listProjects: () => [] },
  }
}

const toggle = (enabled: boolean) =>
  dispatchChannel(specs.find((spec) => spec.channel === 'remote:toggle')!, { enabled })

beforeAll(async () => {
  settings.set('terminator.remote-control.enabled', false)
  settings.set('terminator.remote-control.port', 7681)
  settings.set('terminator.remote-control.passwordHash', await hashPassword('a-long-password'))
  createRemoteServer.mockResolvedValue({
    start: async () => {},
    stop: async () => {},
    isListening: () => true,
    disconnectAllClients: () => {},
    devices: { onChange: () => () => {}, list: () => [] },
  })
})

describe('the remote server', () => {
  it('is not loaded while Remote Control is off, and is once it is turned on', async () => {
    const { activate } = await import('../../src/index.ts')
    activate(api() as never)
    expect(loaded.server).toBe(false)

    await toggle(true)

    await vi.waitFor(() => expect(createRemoteServer).toHaveBeenCalled())
    expect(loaded.server).toBe(true)
  })
})
