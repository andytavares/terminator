import type { ExtensionAPI, Disposable } from '@terminator/extension-sdk'

// All notepad IPC channels register through the ExtensionAPI — never through
// ipcMain directly (Extension Isolation). Registration records the channel in
// the remote bridge registry. A channel is local-only unless it registers through
// handleRemote.
export function createIpcRegistrar(api: ExtensionAPI): {
  handle(channel: string, fn: (payload: unknown) => Promise<unknown> | unknown): void
  /** Like `handle`, and also reachable from the remote browser client. */
  handleRemote(channel: string, fn: (payload: unknown) => Promise<unknown> | unknown): void
  cleanup(): void
} {
  const disposables: Disposable[] = []
  return {
    handle(channel, fn) {
      disposables.push(api.ipc.registerHandler(channel, fn))
    },
    handleRemote(channel, fn) {
      disposables.push(api.ipc.registerHandler(channel, fn, { remoteAccessible: true }))
    },
    cleanup() {
      disposables.forEach((d) => d.dispose())
    },
  }
}
