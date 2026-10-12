import Store from 'electron-store'

let directory: string | undefined

/**
 * Where this extension's stores live: `api.paths.userData`, bound by `activate`.
 * The extension host has no `electron.app` for electron-store to find it with.
 */
export function setStoreDirectory(path: string): void {
  directory = path
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
