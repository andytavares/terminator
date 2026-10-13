import { describe, it, expect, vi, beforeEach } from 'vitest'

// A stand-in for electron-store that counts file reads and lets a test change the
// "file" behind the cache's back, then announce it the way electron-store does.
const file = vi.hoisted(() => ({
  data: {} as Record<string, unknown>,
  reads: 0,
  anyChangeCallbacks: [] as Array<() => void>,
  options: undefined as unknown,
}))

vi.mock('electron-store', () => ({
  default: class MockStore {
    constructor(options: { defaults?: Record<string, unknown> }) {
      file.options = options
      file.data = JSON.parse(JSON.stringify(options.defaults ?? {}))
    }
    get(key: string) {
      file.reads++
      return JSON.parse(JSON.stringify(file.data[key] ?? null))
    }
    set(key: string, value: unknown) {
      file.data[key] = value
    }
    onDidAnyChange(callback: () => void) {
      file.anyChangeCallbacks.push(callback)
      return () => {}
    }
  },
}))

interface Schema {
  names: string[]
  settings: { theme: string }
}

async function newStore() {
  const { CachedStore } = await import('../../../src/main/storage/cached-store')
  return new CachedStore<Schema>({
    name: 'test',
    defaults: { names: [], settings: { theme: 'dark' } },
  })
}

function useCountingStore(): void {
  beforeEach(() => {
    vi.resetModules()
    file.reads = 0
    file.anyChangeCallbacks = []
  })
}

describe('CachedStore', () => {
  useCountingStore()

  it('reads a key from the file once however many times it is read', async () => {
    const store = await newStore()

    store.get('settings')
    store.get('settings')
    store.get('settings')

    expect(file.reads).toBe(1)
  })

  it('returns the value just written', async () => {
    const store = await newStore()
    store.get('names')

    store.set('names', ['a'])

    expect(store.get('names')).toEqual(['a'])
  })

  it('sees a change made to the file by someone else once electron-store reports it', async () => {
    const store = await newStore()
    expect(store.get('settings')).toEqual({ theme: 'dark' })

    file.data.settings = { theme: 'light' }
    expect(store.get('settings')).toEqual({ theme: 'dark' })
    for (const callback of file.anyChangeCallbacks) callback()

    expect(store.get('settings')).toEqual({ theme: 'light' })
  })
})

describe('CachedStore — copies and file watching', () => {
  useCountingStore()

  it('does not let a caller change the cached value by changing what it was given back', async () => {
    const store = await newStore()

    store.get('names').push('mutated')

    expect(store.get('names')).toEqual([])
  })

  it('asks electron-store to watch the file so that other writers are noticed', async () => {
    await newStore()

    expect(file.options).toMatchObject({ watch: true })
  })
})
