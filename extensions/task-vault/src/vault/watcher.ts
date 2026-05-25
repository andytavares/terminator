import chokidar, { type FSWatcher } from 'chokidar'
import { buildIndex } from './indexer'
import type { VaultIndex } from './types'

let watcher: FSWatcher | null = null
let debounceTimer: ReturnType<typeof setTimeout> | null = null
const DEBOUNCE_MS = 200

export async function startWatcher(
  vaultPath: string,
  onIndexUpdated: (index: VaultIndex) => void
): Promise<void> {
  if (watcher) await stopWatcher()

  watcher = chokidar.watch(vaultPath, {
    ignored: /archive/,
    persistent: true,
    ignoreInitial: true,
  })

  const handleChange = () => {
    if (debounceTimer) clearTimeout(debounceTimer)
    debounceTimer = setTimeout(async () => {
      const index = await buildIndex(vaultPath)
      onIndexUpdated(index)
    }, DEBOUNCE_MS)
  }

  watcher.on('change', handleChange)
  watcher.on('add', handleChange)
  watcher.on('unlink', handleChange)
}

export async function stopWatcher(): Promise<void> {
  if (debounceTimer) {
    clearTimeout(debounceTimer)
    debounceTimer = null
  }
  if (watcher) {
    await watcher.close()
    watcher = null
  }
}
