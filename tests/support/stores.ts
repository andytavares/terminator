type Data = Record<string, unknown>

/** The part of electron-store that CachedStore uses, held in memory. */
class InMemoryElectronStore {
  private readonly data: Data

  constructor(options?: { defaults?: Data }) {
    this.data = structuredClone(options?.defaults ?? {})
  }

  get(key: string): unknown {
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
