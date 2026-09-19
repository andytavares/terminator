import { describe, it, expect } from 'vitest'
import {
  recordUsage,
  pruneUsage,
  togglePin,
  recordDirectUse,
  shouldShowHint,
  HINT_LIMIT,
} from '../../../../src/renderer/quick-actions/usage'
import type { ActionUsage, DirectUse } from '../../../../src/shared/types'

describe('recordUsage', () => {
  it('adds a new entry for a first use', () => {
    const result = recordUsage([], 'a', 1000)
    expect(result).toEqual([{ id: 'a', count: 1, lastUsedAt: 1000 }])
  })

  it('increments count and bumps lastUsedAt for an existing entry', () => {
    const usage: ActionUsage[] = [{ id: 'a', count: 2, lastUsedAt: 500 }]
    const result = recordUsage(usage, 'a', 1000)
    expect(result).toEqual([{ id: 'a', count: 3, lastUsedAt: 1000 }])
  })

  it('returns a new array, never mutating the input', () => {
    const usage: ActionUsage[] = [{ id: 'a', count: 1, lastUsedAt: 500 }]
    const result = recordUsage(usage, 'a', 1000)
    expect(result).not.toBe(usage)
    expect(usage).toEqual([{ id: 'a', count: 1, lastUsedAt: 500 }])
  })
})

describe('pruneUsage', () => {
  it('drops entries whose id is not live', () => {
    const entries = [{ id: 'a' }, { id: 'ghost' }]
    const result = pruneUsage(entries, new Set(['a']))
    expect(result).toEqual([{ id: 'a' }])
  })

  it('keeps all entries when every id is live', () => {
    const entries = [{ id: 'a' }, { id: 'b' }]
    const result = pruneUsage(entries, new Set(['a', 'b']))
    expect(result).toEqual(entries)
  })
})

describe('togglePin', () => {
  it('adds an id that is not pinned', () => {
    expect(togglePin([], 'a')).toEqual(['a'])
  })

  it('removes an id that is already pinned', () => {
    expect(togglePin(['a', 'b'], 'a')).toEqual(['b'])
  })

  it('does not mutate the input array', () => {
    const pins = ['a']
    togglePin(pins, 'b')
    expect(pins).toEqual(['a'])
  })
})

describe('recordDirectUse', () => {
  it('adds a new entry starting at count 1', () => {
    expect(recordDirectUse([], 'a')).toEqual([{ id: 'a', count: 1 }])
  })

  it('increments an existing entry', () => {
    const directUse: DirectUse[] = [{ id: 'a', count: 2 }]
    expect(recordDirectUse(directUse, 'a')).toEqual([{ id: 'a', count: 3 }])
  })
})

describe('shouldShowHint', () => {
  it('is true when the action has a shortcut and direct count is below the limit', () => {
    const result = shouldShowHint({ id: 'a', shortcut: '⌘D' }, [{ id: 'a', count: HINT_LIMIT - 1 }])
    expect(result).toBe(true)
  })

  it('is false when the action has no shortcut', () => {
    const result = shouldShowHint({ id: 'a' }, [])
    expect(result).toBe(false)
  })

  it('is false once direct count reaches the limit', () => {
    const result = shouldShowHint({ id: 'a', shortcut: '⌘D' }, [{ id: 'a', count: HINT_LIMIT }])
    expect(result).toBe(false)
  })

  it('is true when there is no direct-use entry yet', () => {
    const result = shouldShowHint({ id: 'a', shortcut: '⌘D' }, [])
    expect(result).toBe(true)
  })
})
