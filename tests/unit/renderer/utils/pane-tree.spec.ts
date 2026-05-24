import { describe, it, expect, vi } from 'vitest'
import {
  splitLeaf,
  removeLeaf,
  leafIds,
  updateSplitRatio,
} from '../../../../src/renderer/utils/pane-tree'
import type { PaneNode } from '../../../../src/shared/types/index'

// Deterministic UUIDs for snapshots
vi.stubGlobal('crypto', { randomUUID: vi.fn(() => 'test-uuid') })

function leaf(sessionId: string): PaneNode {
  return { type: 'leaf', sessionId }
}

function split(
  id: string,
  direction: 'horizontal' | 'vertical',
  first: PaneNode,
  second: PaneNode,
  ratio = 0.5
): PaneNode {
  return { type: 'split', id, direction, ratio, first, second }
}

describe('splitLeaf', () => {
  it('replaces a matching leaf with a split', () => {
    const result = splitLeaf(leaf('a'), 'a', 'b', 'vertical')
    expect(result).toEqual(split('test-uuid', 'vertical', leaf('a'), leaf('b')))
  })

  it('does not change a non-matching leaf', () => {
    const result = splitLeaf(leaf('x'), 'a', 'b', 'vertical')
    expect(result).toEqual(leaf('x'))
  })

  it('splits a leaf nested inside a split node', () => {
    const tree = split('s1', 'vertical', leaf('a'), leaf('b'))
    const result = splitLeaf(tree, 'b', 'c', 'horizontal')
    expect(result).toEqual(
      split('s1', 'vertical', leaf('a'), split('test-uuid', 'horizontal', leaf('b'), leaf('c')))
    )
  })

  it('sets ratio to 0.5 on the new split', () => {
    const result = splitLeaf(leaf('a'), 'a', 'b', 'horizontal')
    if (result.type !== 'split') throw new Error('expected split')
    expect(result.ratio).toBe(0.5)
  })

  it('positions the new leaf as the second child', () => {
    const result = splitLeaf(leaf('a'), 'a', 'new', 'vertical')
    if (result.type !== 'split') throw new Error('expected split')
    expect(result.first).toEqual(leaf('a'))
    expect(result.second).toEqual(leaf('new'))
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
    const tree = split('s1', 'vertical', leaf('a'), leaf('b'))
    expect(removeLeaf(tree, 'a')).toEqual(leaf('b'))
  })

  it('collapses the split when the second child is removed', () => {
    const tree = split('s1', 'vertical', leaf('a'), leaf('b'))
    expect(removeLeaf(tree, 'b')).toEqual(leaf('a'))
  })

  it('removes a deeply nested leaf and collapses the parent', () => {
    const tree = split('s1', 'vertical', leaf('a'), split('s2', 'horizontal', leaf('b'), leaf('c')))
    const result = removeLeaf(tree, 'b')
    expect(result).toEqual(split('s1', 'vertical', leaf('a'), leaf('c')))
  })

  it('preserves structure when removing from a 3-leaf tree and 2 remain', () => {
    const tree = split('s1', 'vertical', split('s2', 'horizontal', leaf('a'), leaf('b')), leaf('c'))
    const result = removeLeaf(tree, 'a')
    expect(result).toEqual(split('s1', 'vertical', leaf('b'), leaf('c')))
  })
})

describe('leafIds', () => {
  it('returns a single id for a leaf node', () => {
    expect(leafIds(leaf('a'))).toEqual(['a'])
  })

  it('returns all leaf ids in a split', () => {
    const tree = split('s1', 'vertical', leaf('a'), leaf('b'))
    expect(leafIds(tree)).toEqual(['a', 'b'])
  })

  it('returns all ids for a deep tree in DFS order', () => {
    const tree = split('s1', 'vertical', split('s2', 'horizontal', leaf('a'), leaf('b')), leaf('c'))
    expect(leafIds(tree)).toEqual(['a', 'b', 'c'])
  })
})

describe('updateSplitRatio', () => {
  it('returns a leaf unchanged', () => {
    expect(updateSplitRatio(leaf('a'), 'does-not-exist', 0.7)).toEqual(leaf('a'))
  })

  it('updates the ratio of a matching split node', () => {
    const tree = split('s1', 'vertical', leaf('a'), leaf('b'), 0.5)
    const result = updateSplitRatio(tree, 's1', 0.7)
    if (result.type !== 'split') throw new Error('expected split')
    expect(result.ratio).toBe(0.7)
  })

  it('does not change other properties when updating ratio', () => {
    const tree = split('s1', 'vertical', leaf('a'), leaf('b'), 0.5)
    const result = updateSplitRatio(tree, 's1', 0.3)
    if (result.type !== 'split') throw new Error('expected split')
    expect(result.id).toBe('s1')
    expect(result.direction).toBe('vertical')
    expect(result.first).toEqual(leaf('a'))
    expect(result.second).toEqual(leaf('b'))
  })

  it('updates a nested split node', () => {
    const tree = split(
      's1',
      'vertical',
      leaf('a'),
      split('s2', 'horizontal', leaf('b'), leaf('c'), 0.5)
    )
    const result = updateSplitRatio(tree, 's2', 0.8)
    if (result.type !== 'split') throw new Error('expected split')
    if (result.second.type !== 'split') throw new Error('expected nested split')
    expect(result.second.ratio).toBe(0.8)
    expect(result.ratio).toBe(0.5)
  })

  it('returns tree unchanged when splitId does not match', () => {
    const tree = split('s1', 'vertical', leaf('a'), leaf('b'), 0.5)
    const result = updateSplitRatio(tree, 'does-not-exist', 0.9)
    expect(result).toEqual(tree)
  })
})
