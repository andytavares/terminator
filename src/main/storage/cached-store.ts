import Store from 'electron-store'

/**
 * An electron-store that reads its file once per key instead of on every get
 * (electron-store parses the whole file each time).
 *
 * The cache is dropped on this store's own writes and whenever electron-store
 * reports a change, which with `watch` on includes writes by anyone else.
 * Values are handed out as copies so a caller changing one cannot change the
 * cache.
 */
export class CachedStore<Schema extends object> {
  private readonly store: Store<Schema>
  private readonly cache = new Map<keyof Schema, unknown>()

  constructor(options: Store.Options<Schema>) {
    this.store = new Store<Schema>({ watch: true, ...options })
    this.store.onDidAnyChange(() => this.cache.clear())
  }

  get<Key extends keyof Schema>(key: Key): Schema[Key] {
    if (!this.cache.has(key)) this.cache.set(key, this.store.get(key))
    return structuredClone(this.cache.get(key)) as Schema[Key]
  }

  /** Calls `listener` after any change, this store's own writes and other processes' alike. */
  onChange(listener: () => void): () => void {
    return this.store.onDidAnyChange(() => listener())
  }

  set<Key extends keyof Schema & string>(key: Key, value: Schema[Key]): void {
    this.cache.clear()
    this.store.set(key, value)
  }
}
