import { mkdirSync } from 'node:fs'
import type Store from 'electron-store'
import type { ExtensionAPI } from '@terminator/extension-sdk'
import { moveFromUserData } from '@terminator/extension-sdk/node'

// Every store this extension keeps. `config` is merge flow's, electron-store's default name.
const STORE_NAMES = [
  'config',
  'pr-review-sessions',
  'pr-active-reviews',
  'pr-agent-reviews',
] as const

type StoreName = (typeof STORE_NAMES)[number]

let directory: string | undefined

/** Opens `api.paths.globalStorage` for the stores, after moving the ones earlier builds kept in the
 *  shared userData folder. The extension host has no `electron.app` for electron-store. */
export function openStorageDirectory(api: ExtensionAPI): string {
  const folder = api.paths.globalStorage
  moveFromUserData(
    api,
    STORE_NAMES.map((name) => ({ from: `${name}.json`, to: `${name}.json` }))
  )
  mkdirSync(folder, { recursive: true })
  directory = folder
  return folder
}

const opened = new Map<StoreName, Promise<Store<Record<string, unknown>>>>()

/** The named store in that directory, opened on first use. electron-store is imported then, not at
 *  activation: it costs the extension host 17 MB. */
export function namedStore<T = unknown>(name: StoreName): Promise<Store<Record<string, T>>> {
  let store = opened.get(name)
  if (!store) {
    store = import('electron-store').then(
      ({ default: ElectronStore }) =>
        new ElectronStore<Record<string, unknown>>({ name, cwd: directory })
    )
    opened.set(name, store)
  }
  return store as Promise<Store<Record<string, T>>>
}
