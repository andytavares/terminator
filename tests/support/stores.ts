type Data = Record<string, unknown>

/** Stores whose file is corrupt, by name. */
const unreadable = new Set<string>()

/** The part of electron-store that CachedStore uses, held in memory. */
class InMemoryElectronStore {
  private readonly data: Data
  private readonly name: string

  constructor(options?: { name?: string; defaults?: Data }) {
    this.name = options?.name ?? 'config'
    this.data = structuredClone(options?.defaults ?? {})
  }

  get(key: string): unknown {
    // electron-store re-reads its file on every get, and throws on one that is not JSON.
    if (unreadable.has(this.name)) throw new SyntaxError(`${this.name}.json is not valid JSON`)
    return this.data[key]
  }

  set(key: string, value: unknown): void {
    this.data[key] = value
  }

  onDidAnyChange(): () => void {
    return () => {}
  }
}

/**
 * The electron-store module for `vi.mock`, so a spec runs the real settings,
 * workspace and extension-settings stores instead of a partial mock of them.
 * Every store starts from its defaults; re-import the store module after
 * `vi.resetModules()` to start again.
 *
 *   vi.mock('electron-store', async () =>
 *     (await import('../../support/stores')).inMemoryElectronStore())
 */
export function inMemoryElectronStore(): { default: typeof InMemoryElectronStore } {
  return { default: InMemoryElectronStore }
}

/**
 * Make the named store's file corrupt, or every file readable again with null.
 * Only for a spec that imports its store modules once, without
 * `vi.resetModules()`, so this module is the one the mock was built from.
 */
export function corruptStoreFile(name: string | null): void {
  if (name === null) unreadable.clear()
  else unreadable.add(name)
}
