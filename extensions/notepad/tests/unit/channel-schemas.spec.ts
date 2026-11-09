import { describe, it, expect, vi } from 'vitest'
import { dispatchChannel, type ChannelSpec, type ExtensionAPI } from '@terminator/extension-sdk'

vi.mock('electron', () => ({ dialog: {} }))
vi.mock('../../src/db/db', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../src/db/db')>()),
  applyNotepadSchema: vi.fn().mockResolvedValue(undefined),
}))

import { activate } from '../../src/index.ts'
import { partialFake } from '../../../../packages/test-support/src/fakes'

const disposable = { dispose: () => {} }

async function activateNotepadCapturingChannels(): Promise<ChannelSpec[]> {
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
// Activation runs at collection time so each channel gets its own row.
const notepadChannels = await activateNotepadCapturingChannels()

describe('every notepad channel', () => {
  it('includes the autosave channel, so the list below is the registered one', () => {
    expect(notepadChannels.map((spec) => spec.channel)).toContain(
      'terminator.notepad:notes.autosave'
    )
  })

  it.each(notepadChannels)('$channel keeps a malformed payload from reaching run', async (spec) => {
    const run = vi.fn()

    await dispatchChannel({ ...spec, run }, 42)

    expect(spec.schema).toBeDefined()
    expect(run).not.toHaveBeenCalled()
  })
})
