/**
 * @vitest-environment jsdom
 *
 * These read and write localStorage, which the node project has no DOM for.
 * The config routes `.spec.ts` to node and only `.spec.tsx` to jsdom, so this
 * docblock is the lever rather than misnaming a file that contains no JSX.
 */
import { describe, it, expect, beforeEach } from 'vitest'
import {
  LANES_STORAGE_KEY,
  loadHiddenLanes,
  saveHiddenLanes,
} from '../../../../src/renderer/sidebar/board-lanes'

describe('board lane visibility persistence', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  it('starts with every lane visible', () => {
    expect(loadHiddenLanes()).toEqual([])
  })

  it('round-trips a hidden lane', () => {
    saveHiddenLanes(['idle'])
    expect(loadHiddenLanes()).toEqual(['idle'])
  })

  it('round-trips several', () => {
    saveHiddenLanes(['idle', 'exited'])
    expect(loadHiddenLanes()).toEqual(['idle', 'exited'])
  })

  it('writes to the documented key', () => {
    saveHiddenLanes(['working'])
    expect(localStorage.getItem(LANES_STORAGE_KEY)).toBe(JSON.stringify(['working']))
  })

  // Corrupt storage degrades to "everything visible" rather than throwing —
  // the same convention as views.ts loadViews and workspace.store's
  // loadExpandedIds. A board that will not render is worse than a board
  // showing one lane too many.
  it.each([
    ['not json', 'nonsense{'],
    ['not an array', '{"idle":true}'],
    ['an array of non-strings', '[1,2,3]'],
    ['an array of unknown states', '["banana"]'],
    ['an empty string', ''],
  ])('degrades to all-visible when storage holds %s', (_name, stored) => {
    localStorage.setItem(LANES_STORAGE_KEY, stored)
    expect(loadHiddenLanes()).toEqual([])
  })

  it('keeps only the states it recognises', () => {
    localStorage.setItem(LANES_STORAGE_KEY, JSON.stringify(['idle', 'banana', 'exited']))
    expect(loadHiddenLanes()).toEqual(['idle', 'exited'])
  })

  it('survives storage that throws on read', () => {
    const getItem = Storage.prototype.getItem
    Storage.prototype.getItem = () => {
      throw new Error('denied')
    }
    try {
      expect(loadHiddenLanes()).toEqual([])
    } finally {
      Storage.prototype.getItem = getItem
    }
  })

  it('survives storage that throws on write', () => {
    const setItem = Storage.prototype.setItem
    Storage.prototype.setItem = () => {
      throw new Error('quota')
    }
    try {
      expect(() => saveHiddenLanes(['idle'])).not.toThrow()
    } finally {
      Storage.prototype.setItem = setItem
    }
  })
})
