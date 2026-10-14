import { describe, it, expect, vi, beforeEach } from 'vitest'

const getCommands = vi.fn()
const list = vi.fn()
Object.defineProperty(globalThis, 'window', {
  value: { electronAPI: { extension: { getCommands, list } } },
  writable: true,
})

import { useExtensionCommandsStore } from '../../../../src/renderer/stores/extension-commands.store'

const registered = {
  key: 'notes.new',
  extensionId: 'terminator.notepad',
  id: 'notes.new',
  label: 'New note',
}

beforeEach(() => {
  useExtensionCommandsStore.setState({ registered: [], declared: [] })
  getCommands.mockResolvedValue({ commands: [registered] })
  list.mockResolvedValue({
    extensions: [
      {
        id: 'terminator.notepad',
        contributes: { commands: [{ id: 'notes.new', label: 'New note', mnemonic: 'n' }] },
      },
      { id: 'terminator.empty' },
    ],
  })
})

describe('useExtensionCommandsStore', () => {
  it('holds every registered command and every command a manifest declares', async () => {
    await useExtensionCommandsStore.getState().refresh()

    const { registered: held, declared } = useExtensionCommandsStore.getState()
    expect(held).toEqual([registered])
    expect(declared).toEqual([
      {
        extensionId: 'terminator.notepad',
        id: 'notes.new',
        label: 'New note',
        mnemonic: 'n',
        shortcut: undefined,
        description: undefined,
        requires: undefined,
      },
    ])
  })

  it('keeps what it last read while a refresh is still on its way', async () => {
    await useExtensionCommandsStore.getState().refresh()
    getCommands.mockReturnValue(new Promise(() => {}))
    list.mockReturnValue(new Promise(() => {}))

    void useExtensionCommandsStore.getState().refresh()

    expect(useExtensionCommandsStore.getState().registered).toEqual([registered])
    expect(useExtensionCommandsStore.getState().declared).toHaveLength(1)
  })
})
