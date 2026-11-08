import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import {
  DEFAULT_WALL_PREFS,
  WALL_PREFS_KEY,
  loadWallPrefs,
  saveWallPrefs,
} from '../../../../src/renderer/sidebar/wall-prefs'

const storage = new Map<string, string>()

beforeEach(() => {
  storage.clear()
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => storage.get(k) ?? null,
    setItem: (k: string, v: string) => storage.set(k, v),
  })
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('loadWallPrefs', () => {
  it('defaults to medium tiles, pinned needs, then by state', () => {
    expect(loadWallPrefs()).toEqual({ size: 'm', pinNeeds: true, thenBy: 'state' })
  })

  it.each([
    [{ size: 'l', pinNeeds: false, thenBy: 'recent' }],
    [{ size: 'm', pinNeeds: true, thenBy: 'task' }],
  ] as const)('reads back what was saved: %j', (prefs) => {
    saveWallPrefs(prefs)
    expect(loadWallPrefs()).toEqual(prefs)
  })

  it.each([['{nope'], ['4'], ['null'], ['[]']])('falls back for unreadable storage: %s', (raw) => {
    storage.set(WALL_PREFS_KEY, raw)
    expect(loadWallPrefs()).toEqual(DEFAULT_WALL_PREFS)
  })

  it('replaces only the invalid fields', () => {
    storage.set(WALL_PREFS_KEY, JSON.stringify({ size: 'xl', pinNeeds: false, thenBy: 'colour' }))
    expect(loadWallPrefs()).toEqual({ size: 'm', pinNeeds: false, thenBy: 'state' })
  })
})

describe('loadWallPrefs — storage that throws', () => {
  it('falls back when storage throws, and never throws on save', () => {
    vi.stubGlobal('localStorage', {
      getItem: () => {
        throw new Error('denied')
      },
      setItem: () => {
        throw new Error('quota')
      },
    })
    expect(loadWallPrefs()).toEqual(DEFAULT_WALL_PREFS)
    expect(() => saveWallPrefs(DEFAULT_WALL_PREFS)).not.toThrow()
  })
})
