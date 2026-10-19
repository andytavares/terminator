import { describe, it, expect } from 'vitest'
import { storedFocusOf, storedParkedOf } from '../../../../src/renderer/home/stored-shapes'

const item = { id: 'f1', title: 'Get TAV-14 approved', doneByHand: false }

describe('storedFocusOf', () => {
  it('reads a stored focus and fills missing fields with their empty values', () => {
    expect(storedFocusOf({ days: { '2026-10-18': [item] } })).toEqual({
      days: { '2026-10-18': [item] },
      planDismissedOn: null,
      planCollapsed: false,
    })
  })

  it('reads an older stored value without planCollapsed as not collapsed', () => {
    const stored = { days: {}, planDismissedOn: '2026-10-17' }
    expect(storedFocusOf(stored)).toEqual({
      days: {},
      planDismissedOn: '2026-10-17',
      planCollapsed: false,
    })
  })

  it('keeps a ticket or a branch work key and the stored fields', () => {
    const keyed = [
      { ...item, workKey: { tracker: 'linear', key: 'TAV-14' } },
      {
        ...item,
        id: 'f2',
        workKey: { repoRoot: '/r', branch: 'main' },
        detail: 'pull request #271',
      },
    ]
    const stored = { days: { d: keyed }, planDismissedOn: 'd', planCollapsed: true }
    expect(storedFocusOf(stored)).toEqual(stored)
  })
})

describe('storedFocusOf: what it refuses', () => {
  it.each([
    ['not an object', 'focus'],
    ['no days', {}],
    ['days that are not lists', { days: { d: 'x' } }],
    ['an item without a title', { days: { d: [{ id: 'f1', doneByHand: false }] } }],
    ['a work key of neither kind', { days: { d: [{ ...item, workKey: { key: 'TAV-1' } }] } }],
    ['a collapsed flag that is not a boolean', { days: {}, planCollapsed: 'yes' }],
  ])('refuses %s', (_name, value) => {
    expect(storedFocusOf(value)).toBeNull()
  })
})

describe('storedParkedOf', () => {
  it('reads keys with when each was parked', () => {
    expect(storedParkedOf({ 'linear:TAV-20': 10 }, 99)).toEqual({ 'linear:TAV-20': 10 })
  })

  it("reads the first version's bare keys as parked now", () => {
    expect(storedParkedOf(['linear:TAV-20'], 99)).toEqual({ 'linear:TAV-20': 99 })
  })

  it.each([
    ['a list with a non-key', [1]],
    ['a time that is not a number', { k: 'soon' }],
    ['nothing', null],
  ])('refuses %s', (_name, value) => {
    expect(storedParkedOf(value, 99)).toBeNull()
  })
})
