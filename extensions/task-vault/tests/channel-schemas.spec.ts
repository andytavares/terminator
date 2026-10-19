import { describe, it, expect, vi, afterEach } from 'vitest'
import { DatabaseSync } from 'node:sqlite'
import { wrapDb } from '../../../src/main/db/index'
import { dispatchChannel, type ChannelSpec, type ExtensionAPI } from '@terminator/extension-sdk'

vi.mock('electron', () => ({
  BrowserWindow: { getAllWindows: vi.fn().mockReturnValue([]) },
  globalShortcut: { register: vi.fn(), unregister: vi.fn() },
  dialog: {},
}))
vi.mock('../src/notifications/task-scheduler.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/notifications/task-scheduler.js')>()),
  startTaskScheduler: vi.fn(() => ({ dispose: vi.fn(), tick: vi.fn() })),
}))

import { activate, deactivate } from '../src/index.ts'
import { partialFake } from '../../../tests/support/fakes'

const disposable = { dispose: () => {} }

async function activateCapturingChannels(): Promise<ChannelSpec[]> {
  const specs: ChannelSpec[] = []
  const api = partialFake<ExtensionAPI>({
    db: wrapDb(new DatabaseSync(':memory:')),
    ipc: partialFake<ExtensionAPI['ipc']>({
      registerHandler: (spec: ChannelSpec) => {
        specs.push(spec)
        return disposable
      },
    }),
    settings: partialFake<ExtensionAPI['settings']>({
      register: () => disposable,
      get: <T>() => '0' as T,
    }),
    window: partialFake<ExtensionAPI['window']>({ broadcast: () => {}, focusSelf: () => {} }),
    notifications: partialFake<ExtensionAPI['notifications']>({
      showToast: () => {},
      createNotification: () => disposable,
    }),
    nativeMenu: partialFake<ExtensionAPI['nativeMenu']>({ addViewMenuItem: () => disposable }),
    globalShortcut: partialFake<ExtensionAPI['globalShortcut']>({
      register: async () => disposable,
    }),
    commands: partialFake<ExtensionAPI['commands']>({ register: () => disposable }),
    home: { publish: () => {}, onAction: () => disposable },
  })
  await activate(api)
  return specs
}

afterEach(async () => {
  await deactivate()
})

// ADR 096: whether a channel rejects bad input is its schema's job, so this
// checks once, for every channel task-vault registers, that one is declared.
describe('every task-vault channel', () => {
  it('declares a schema that keeps a malformed payload from reaching run', async () => {
    const specs = await activateCapturingChannels()

    expect(specs.map((spec) => spec.channel)).toContain('task-vault:vault:capture')
    for (const spec of specs) {
      expect(spec.schema, `${spec.channel} has no schema`).toBeDefined()
      const run = vi.fn()
      await dispatchChannel({ ...spec, run }, 42)
      expect(run, `${spec.channel} ran a malformed payload`).not.toHaveBeenCalled()
    }
  })
})
