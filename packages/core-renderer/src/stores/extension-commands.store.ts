import { create } from 'zustand'
import type { DeclaredCommand, RegisteredCommand } from '../quick-actions/extension-actions'

// The extension commands Quick Actions offers. Held here rather than in the
// panel, which mounts on every open: keys typed straight after ⌘P ("n n") must
// find the commands already there, not wait for a fresh read.
interface ExtensionCommandsState {
  registered: RegisteredCommand[]
  declared: DeclaredCommand[]
  /** Reads both lists again; until it answers, the last ones stay. */
  refresh: () => Promise<void>
}

async function readDeclared(): Promise<DeclaredCommand[]> {
  const { extensions } = await window.electronAPI.extension.list()
  return extensions.flatMap((ext) =>
    (ext.contributes?.commands ?? []).map((cmd) => ({
      extensionId: ext.id,
      id: cmd.id,
      label: cmd.label,
      mnemonic: cmd.mnemonic,
      shortcut: cmd.shortcut,
      description: cmd.description,
      requires: cmd.requires,
    }))
  )
}

export const useExtensionCommandsStore = create<ExtensionCommandsState>((set) => ({
  registered: [],
  declared: [],
  refresh: async () => {
    const [{ commands }, declared] = await Promise.all([
      window.electronAPI.extension.getCommands(),
      readDeclared(),
    ])
    set({ registered: commands, declared })
  },
}))

/** An extension command's key when it is registered, including one that takes args and so is in
 * no quick-action list; null when its extension is not running it. `id` may be the full key. */
export async function registeredCommandKey(
  extensionId: string,
  id: string
): Promise<string | null> {
  const key = id.includes('.command.') ? id : `${extensionId}.command.${id}`
  return (await window.electronAPI.extension.hasCommand(key)) ? key : null
}
