import { useEffect } from 'react'
import { recordUsage } from '@terminator/extension-sdk/renderer'

/** Runs `reload` whenever the vault index changes; resubscribes when `deps` change. */
export function useIndexReload(reload: () => void, deps: unknown[]): void {
  useEffect(() => {
    return window.electronAPI.extensionBridge.on('task-vault:push:index-updated', () => reload())
  }, deps) // eslint-disable-line react-hooks/exhaustive-deps
}

/** Counts one use of the feature `id` each time the component mounts. */
export function useRecordUsageOnMount(id: string): void {
  useEffect(() => {
    recordUsage(id)
  }, [id])
}
