import { mkdirSync } from 'node:fs'
import Store from 'electron-store'
import type { ExtensionAPI } from '@terminator/extension-sdk'
import { moveFromUserData } from '@terminator/extension-sdk/node'

// Merge flow's `config` (electron-store's default name) and the review stores.
const STORE_FILES = ['config.json', 'pr-review-sessions.json', 'pr-active-reviews.json']

let directory: string | undefined

/**
 * Opens this extension's own folder, `api.paths.globalStorage`, for the stores,
 * after moving the ones earlier builds kept in the shared userData folder. The
 * extension host has no `electron.app` for electron-store to find it with.
 */
export function openStorageDirectory(api: ExtensionAPI): string {
  const folder = api.paths.globalStorage
  moveFromUserData(
    api,
    STORE_FILES.map((file) => ({ from: file, to: file }))
  )
  mkdirSync(folder, { recursive: true })
  directory = folder
  return folder
}

const opened = new Map<string, Store<Record<string, unknown>>>()

/** The named store in that directory, opened on first use. */
export function namedStore<T = unknown>(name: string): Store<Record<string, T>> {
  const existing = opened.get(name)
  if (existing) return existing as Store<Record<string, T>>
  const store = new Store<Record<string, unknown>>({ name, cwd: directory })
  opened.set(name, store)
  return store as Store<Record<string, T>>
}
