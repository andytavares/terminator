import { describe, it, expect, beforeEach, vi } from 'vitest'
import {
  DEFAULT_HOME_PREFS,
  HOME_PREFS_KEY,
  loadHomePrefs,
  saveHomePrefs,
} from '../../../../src/renderer/sidebar/home-prefs'

const storage = new Map<string, string>()

beforeEach(() => {
  storage.clear()
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => storage.get(k) ?? null,
    setItem: (k: string, v: string) => storage.set(k, v),
  })
})

describe('loadHomePrefs', () => {
  it('opens on the Ledger, grouped by workspace and project, needs-you first', () => {
    expect(loadHomePrefs()).toEqual({
      layout: 'ledger',
      groupBy: 'workspace-project',
      sort: 'needs-you',
      columns: { branch: true, workItem: true, tags: false, latestLine: true, age: true },
      previewSelected: true,
      hideExited: false,
    })
    expect(DEFAULT_HOME_PREFS.layout).toBe('ledger')
  })

  it('reads back what was saved', () => {
    const prefs = {
      ...DEFAULT_HOME_PREFS,
      layout: 'logbook' as const,
      columns: { ...DEFAULT_HOME_PREFS.columns, latestLine: false },
    }
    saveHomePrefs(prefs)
    expect(loadHomePrefs()).toEqual(prefs)
  })

  it.each([['{not json'], ['"a string"'], ['null'], ['[1,2]']])(
    'falls back to defaults for unreadable storage: %s',
    (raw) => {
      storage.set(HOME_PREFS_KEY, raw)
      expect(loadHomePrefs()).toEqual(DEFAULT_HOME_PREFS)
    }
  )

  it('keeps the valid fields and replaces only the invalid ones', () => {
    storage.set(
      HOME_PREFS_KEY,
      JSON.stringify({
        layout: 'logbook',
        groupBy: 'by-colour',
        sort: 'recent',
        columns: { branch: false, tags: 'yes' },
        previewSelected: 'no',
        hideExited: true,
      })
    )
    expect(loadHomePrefs()).toEqual({
      layout: 'logbook',
      groupBy: 'workspace-project',
      sort: 'recent',
      columns: { branch: false, workItem: true, tags: false, latestLine: true, age: true },
      previewSelected: true,
      hideExited: true,
    })
  })

  it('falls back to defaults when storage throws', () => {
    vi.stubGlobal('localStorage', {
      getItem: () => {
        throw new Error('denied')
      },
    })
    expect(loadHomePrefs()).toEqual(DEFAULT_HOME_PREFS)
  })
})

describe('saveHomePrefs', () => {
  it('never throws when storage refuses the write', () => {
    vi.stubGlobal('localStorage', {
      setItem: () => {
        throw new Error('quota')
      },
    })
    expect(() => saveHomePrefs(DEFAULT_HOME_PREFS)).not.toThrow()
  })
})
