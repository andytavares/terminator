import { describe, it, expect } from 'vitest'
import { EditorState } from '@codemirror/state'
import {
  commentAnchorField,
  hoveredAnchorField,
  setAnchors,
  setHoveredAnchor,
  type CommentAnchor,
} from '../../../src/editor/commentField'

describe('commentAnchorField', () => {
  const anchor1: CommentAnchor = { id: 'c1', from: 5, to: 10 }
  const anchor2: CommentAnchor = { id: 'c2', from: 15, to: 25 }

  function makeState() {
    return EditorState.create({
      doc: 'Hello world this is a test document for anchoring',
      extensions: [commentAnchorField],
    })
  }

  it('initializes with empty anchor list', () => {
    const state = makeState()
    const anchors = state.field(commentAnchorField)
    expect(anchors).toEqual([])
  })

  it('setAnchors replaces the anchor list', () => {
    let state = makeState()
    state = state.update({ effects: [setAnchors.of([anchor1, anchor2])] }).state
    const anchors = state.field(commentAnchorField)
    expect(anchors).toHaveLength(2)
    expect(anchors[0].id).toBe('c1')
    expect(anchors[1].id).toBe('c2')
  })

  it('maps anchor positions through document changes', () => {
    let state = EditorState.create({
      doc: 'Hello world',
      extensions: [commentAnchorField],
    })
    // Set an anchor at positions 6-11 ("world")
    state = state.update({ effects: [setAnchors.of([{ id: 'c1', from: 6, to: 11 }])] }).state
    // Insert 3 chars at position 0
    state = state.update({ changes: { from: 0, insert: 'AAA' } }).state
    const anchors = state.field(commentAnchorField)
    // Anchor should have shifted by 3
    expect(anchors[0].from).toBe(9)
    expect(anchors[0].to).toBe(14)
  })

  it('removes collapsed anchors after document change', () => {
    let state = EditorState.create({
      doc: 'Hello world',
      extensions: [commentAnchorField],
    })
    state = state.update({ effects: [setAnchors.of([{ id: 'c1', from: 6, to: 11 }])] }).state
    // Delete "world" entirely — anchor collapses to same point
    state = state.update({ changes: { from: 6, to: 11, insert: '' } }).state
    const anchors = state.field(commentAnchorField)
    expect(anchors).toHaveLength(0)
  })

  it('setAnchors overwrites previously mapped anchors', () => {
    let state = makeState()
    state = state.update({ effects: [setAnchors.of([anchor1])] }).state
    state = state.update({ effects: [setAnchors.of([anchor2])] }).state
    const anchors = state.field(commentAnchorField)
    expect(anchors).toHaveLength(1)
    expect(anchors[0].id).toBe('c2')
  })
})

describe('hoveredAnchorField', () => {
  function makeState() {
    return EditorState.create({
      doc: 'Hello',
      extensions: [hoveredAnchorField],
    })
  }

  it('initializes with null', () => {
    const state = makeState()
    expect(state.field(hoveredAnchorField)).toBeNull()
  })

  it('setHoveredAnchor sets the hovered comment id', () => {
    let state = makeState()
    state = state.update({ effects: [setHoveredAnchor.of('c1')] }).state
    expect(state.field(hoveredAnchorField)).toBe('c1')
  })

  it('setHoveredAnchor clears to null', () => {
    let state = makeState()
    state = state.update({ effects: [setHoveredAnchor.of('c1')] }).state
    state = state.update({ effects: [setHoveredAnchor.of(null)] }).state
    expect(state.field(hoveredAnchorField)).toBeNull()
  })

  it('non-matching effects leave value unchanged', () => {
    let state = makeState()
    state = state.update({ effects: [setHoveredAnchor.of('c2')] }).state
    state = state.update({}).state
    expect(state.field(hoveredAnchorField)).toBe('c2')
  })
})
