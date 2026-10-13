import { describe, it, expect, vi } from 'vitest'
import { dispatchChannel, type ChannelSpec, type ExtensionAPI } from '@terminator/extension-sdk'

vi.mock('electron', () => ({ dialog: {} }))
vi.mock('../../src/db/db', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../src/db/db')>()),
  applyNotepadSchema: vi.fn().mockResolvedValue(undefined),
}))

import { activate } from '../../src/index.ts'
import { partialFake } from '../../../../tests/support/fakes'

const disposable = { dispose: () => {} }

async function activateCapturingChannels(): Promise<ChannelSpec[]> {
  const specs: ChannelSpec[] = []
  const api = partialFake<ExtensionAPI>({
    db: partialFake<ExtensionAPI['db']>({}),
    ipc: partialFake<ExtensionAPI['ipc']>({
      registerHandler: (spec: ChannelSpec) => {
        specs.push(spec)
        return disposable
      },
    }),
    settings: partialFake<ExtensionAPI['settings']>({ register: () => disposable }),
    window: partialFake<ExtensionAPI['window']>({ broadcast: () => {}, openAuxiliary: () => {} }),
    notifications: partialFake<ExtensionAPI['notifications']>({ showToast: () => {} }),
    nativeMenu: partialFake<ExtensionAPI['nativeMenu']>({ addViewMenuItem: () => disposable }),
    globalShortcut: partialFake<ExtensionAPI['globalShortcut']>({
      register: async () => disposable,
    }),
    commands: partialFake<ExtensionAPI['commands']>({ register: () => disposable }),
  })
  await activate(api)
  return specs
}

// ADR 096: whether a channel rejects bad input is its schema's job, so this
// checks once, for every channel notepad registers, that one is declared.
describe('every notepad channel', () => {
  it('declares a schema that keeps a malformed payload from reaching run', async () => {
    const specs = await activateCapturingChannels()

    expect(specs.map((spec) => spec.channel)).toContain('terminator.notepad:notes.autosave')
    for (const spec of specs) {
      expect(spec.schema, `${spec.channel} has no schema`).toBeDefined()
      const run = vi.fn()
      await dispatchChannel({ ...spec, run }, 42)
      expect(run, `${spec.channel} ran a malformed payload`).not.toHaveBeenCalled()
    }
  })
})
