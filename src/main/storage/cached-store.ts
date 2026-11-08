import Store, { type Options } from 'electron-store'

/** An electron-store that parses its file once per key, not on every get. The cache drops on any
 * change electron-store reports, which with `watch` on includes other processes' writes. Values are
 * handed out as copies, so a caller changing one cannot change the cache. A schema is a `type`, not
 * an `interface`: electron-store requires a record type, and an interface has no index signature. */
export class CachedStore<Schema extends Record<string, unknown>> {
  private readonly store: Store<Schema>
  private readonly cache = new Map<keyof Schema, unknown>()

  constructor(options: Options<Schema>) {
    this.store = new Store<Schema>({ watch: true, ...options })
    this.store.onDidAnyChange(() => this.cache.clear())
  }

  get<Key extends keyof Schema>(key: Key): Schema[Key] {
    if (!this.cache.has(key)) this.cache.set(key, this.store.get(key))
    return structuredClone(this.cache.get(key)) as Schema[Key]
  }

  /** Calls `listener` after any change, this store's own writes and other processes' alike. */
  onAnyChange(listener: () => void): () => void {
    return this.store.onDidAnyChange(() => listener())
  }

  set<Key extends keyof Schema & string>(key: Key, value: Exclude<Schema[Key], undefined>): void {
    this.cache.clear()
    this.store.set(key, value)
  }
}
