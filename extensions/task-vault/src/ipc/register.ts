import type { ExtensionAPI, Disposable } from '../../../../src/main/extensions/api'

// All task-vault IPC channels register through the ExtensionAPI — never through
// ipcMain directly (Extension Isolation). Registration records the channel in
// the remote bridge registry, so the /app/ browser surface can dispatch it.
export function createIpcRegistrar(api: ExtensionAPI): {
  handle(channel: string, fn: (payload: unknown) => Promise<unknown> | unknown): void
  cleanup(): void
} {
  const disposables: Disposable[] = []
  return {
    handle(channel, fn) {
      disposables.push(api.ipc.registerHandler(channel, fn))
    },
    cleanup() {
      disposables.forEach((d) => d.dispose())
    },
  }
}
