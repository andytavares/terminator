import { useEffect } from 'react'

/** Runs `reload` whenever the vault index changes; resubscribes when `deps` change. */
export function useIndexReload(reload: () => void, deps: unknown[]): void {
  useEffect(() => {
    return window.electronAPI.extensionBridge.on('task-vault:push:index-updated', () => reload())
  }, deps) // eslint-disable-line react-hooks/exhaustive-deps
}
