import { describe, it, expect } from 'vitest'
import { mergeReorder } from '../../../../src/renderer/sidebar/manual-order'

interface Item {
  id: string
}

const idOf = (item: Item): string => item.id
const items = (...ids: string[]): Item[] => ids.map((id) => ({ id }))
const ids = (list: Item[]): string[] => list.map(idOf)

describe('mergeReorder', () => {
  it('returns the dragged order when every item is on screen', () => {
    const all = items('a', 'b', 'c')
    expect(ids(mergeReorder(all, items('c', 'a', 'b'), idOf))).toEqual(['c', 'a', 'b'])
  })

  // The list you drag in is the list you can see. A search or a view can be
  // hiding half of it, and a hidden row must keep its place rather than be
  // swept to the end by an order that never mentioned it.
  it('rewrites only the slots the visible rows occupy', () => {
    const all = items('a', 'b', 'c', 'd')
    expect(ids(mergeReorder(all, items('d', 'b'), idOf))).toEqual(['a', 'd', 'c', 'b'])
  })

  it('leaves the list alone when nothing was on screen', () => {
    const all = items('a', 'b')
    expect(ids(mergeReorder(all, [], idOf))).toEqual(['a', 'b'])
  })

  it('ignores an item that is not in the list at all', () => {
    const all = items('a', 'b')
    expect(ids(mergeReorder(all, items('b', 'ghost', 'a'), idOf))).toEqual(['b', 'a'])
  })

  it('does not mutate the list it was given', () => {
    const all = items('a', 'b')
    mergeReorder(all, items('b', 'a'), idOf)
    expect(ids(all)).toEqual(['a', 'b'])
  })
})
