import { describe, expect, it } from 'vitest'
import type { Key } from 'ink'
import { START_VIEW, viewAfterKey, type KeyContext } from '../../../src/tui/view'

const NO_KEY = {} as Key
const CONTEXT: KeyContext = { snapshot: null, commands: [], exit: () => {}, run: () => {} }
const FILTERING = { ...START_VIEW, mode: { kind: 'filter' as const } }

describe('typing into the filter', () => {
  it('takes a character outside the Basic Multilingual Plane as one key', () => {
    expect(viewAfterKey(FILTERING, { input: '🚀', key: NO_KEY }, CONTEXT).filter).toBe('🚀')
  })

  it('takes a pasted chunk one character at a time', () => {
    expect(viewAfterKey(FILTERING, { input: 'ab🚀', key: NO_KEY }, CONTEXT).filter).toBe('ab🚀')
  })
})
