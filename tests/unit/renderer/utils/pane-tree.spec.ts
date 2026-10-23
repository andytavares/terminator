import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  splitLeaf,
  removeLeaf,
  leafIds,
  updateSplitRatio,
} from '../../../../src/renderer/utils/pane-tree'
import type { PaneNode } from '../../../../src/shared/types/index'

// Deterministic UUIDs for snapshots
beforeEach(() => {
  vi.stubGlobal('crypto', { randomUUID: vi.fn(() => 'test-uuid') })
})

function leaf(sessionId: string): PaneNode {
  return { type: 'leaf', sessionId }
}

function split(
  id: string,
  [first, second]: [PaneNode, PaneNode],
  { direction, ratio = 0.5 }: { direction: 'horizontal' | 'vertical'; ratio?: number }
): PaneNode {
  return { type: 'split', id, direction, ratio, first, second }
}

describe('splitLeaf', () => {
  it('replaces a matching leaf with a split', () => {
    const result = splitLeaf(leaf('a'), { targetId: 'a', newId: 'b', direction: 'vertical' })
    expect(result).toEqual(split('test-uuid', [leaf('a'), leaf('b')], { direction: 'vertical' }))
  })

  it('does not change a non-matching leaf', () => {
    const result = splitLeaf(leaf('x'), { targetId: 'a', newId: 'b', direction: 'vertical' })
    expect(result).toEqual(leaf('x'))
  })

  it('splits a leaf nested inside a split node', () => {
    const tree = split('s1', [leaf('a'), leaf('b')], { direction: 'vertical' })
    const result = splitLeaf(tree, { targetId: 'b', newId: 'c', direction: 'horizontal' })
    expect(result).toEqual(
      split(
        's1',
        [leaf('a'), split('test-uuid', [leaf('b'), leaf('c')], { direction: 'horizontal' })],
        {
          direction: 'vertical',
        }
      )
    )
  })
})

describe('removeLeaf', () => {
  it('returns null for a single matching leaf', () => {
    expect(removeLeaf(leaf('a'), 'a')).toBeNull()
  })

  it('returns the leaf unchanged for a non-matching leaf', () => {
    expect(removeLeaf(leaf('x'), 'a')).toEqual(leaf('x'))
  })

  it('collapses the split when the first child is removed', () => {
    const tree = split('s1', [leaf('a'), leaf('b')], { direction: 'vertical' })
    expect(removeLeaf(tree, 'a')).toEqual(leaf('b'))
  })

  it('collapses the split when the second child is removed', () => {
    const tree = split('s1', [leaf('a'), leaf('b')], { direction: 'vertical' })
    expect(removeLeaf(tree, 'b')).toEqual(leaf('a'))
  })
})

describe('removeLeaf in nested trees', () => {
  it('removes a deeply nested leaf and collapses the parent', () => {
    const tree = split(
      's1',
      [leaf('a'), split('s2', [leaf('b'), leaf('c')], { direction: 'horizontal' })],
      {
        direction: 'vertical',
      }
    )
    const result = removeLeaf(tree, 'b')
    expect(result).toEqual(split('s1', [leaf('a'), leaf('c')], { direction: 'vertical' }))
  })

  it('preserves structure when removing from a 3-leaf tree and 2 remain', () => {
    const tree = split(
      's1',
      [split('s2', [leaf('a'), leaf('b')], { direction: 'horizontal' }), leaf('c')],
      {
        direction: 'vertical',
      }
    )
    const result = removeLeaf(tree, 'a')
    expect(result).toEqual(split('s1', [leaf('b'), leaf('c')], { direction: 'vertical' }))
  })
})

describe('leafIds', () => {
  it('returns a single id for a leaf node', () => {
    expect(leafIds(leaf('a'))).toEqual(['a'])
  })

  it('returns all leaf ids in a split', () => {
    const tree = split('s1', [leaf('a'), leaf('b')], { direction: 'vertical' })
    expect(leafIds(tree)).toEqual(['a', 'b'])
  })

  it('returns all ids for a deep tree in DFS order', () => {
    const tree = split(
      's1',
      [split('s2', [leaf('a'), leaf('b')], { direction: 'horizontal' }), leaf('c')],
      {
        direction: 'vertical',
      }
    )
    expect(leafIds(tree)).toEqual(['a', 'b', 'c'])
  })
})

describe('updateSplitRatio', () => {
  it('returns a leaf unchanged', () => {
    expect(updateSplitRatio(leaf('a'), 'does-not-exist', 0.7)).toEqual(leaf('a'))
  })

  it('updates the ratio of a matching split node and nothing else', () => {
    const tree = split('s1', [leaf('a'), leaf('b')], { direction: 'vertical', ratio: 0.5 })
    expect(updateSplitRatio(tree, 's1', 0.3)).toEqual(
      split('s1', [leaf('a'), leaf('b')], { direction: 'vertical', ratio: 0.3 })
    )
  })

  it('updates a nested split node', () => {
    const tree = split(
      's1',
      [leaf('a'), split('s2', [leaf('b'), leaf('c')], { direction: 'horizontal', ratio: 0.5 })],
      {
        direction: 'vertical',
      }
    )
    const result = updateSplitRatio(tree, 's2', 0.8)
    if (result.type !== 'split') throw new Error('expected split')
    if (result.second.type !== 'split') throw new Error('expected nested split')
    expect(result.second.ratio).toBe(0.8)
    expect(result.ratio).toBe(0.5)
  })

  it('returns tree unchanged when splitId does not match', () => {
    const tree = split('s1', [leaf('a'), leaf('b')], { direction: 'vertical', ratio: 0.5 })
    const result = updateSplitRatio(tree, 'does-not-exist', 0.9)
    expect(result).toEqual(tree)
  })
})
