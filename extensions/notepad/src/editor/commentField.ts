import { RangeSetBuilder, StateField, StateEffect } from '@codemirror/state'
import {
  Decoration,
  type DecorationSet,
  EditorView,
  ViewPlugin,
  type ViewUpdate,
} from '@codemirror/view'

export interface CommentAnchor {
  id: string
  from: number
  to: number
}

export const setAnchors = StateEffect.define<CommentAnchor[]>()
export const setHoveredAnchor = StateEffect.define<string | null>()

export const hoveredAnchorField = StateField.define<string | null>({
  create() {
    return null
  },
  update(val, tr) {
    for (const e of tr.effects) {
      if (e.is(setHoveredAnchor)) return e.value
    }
    return val
  },
})

export const commentAnchorField = StateField.define<CommentAnchor[]>({
  create() {
    return []
  },

  update(anchors, tr) {
    let mapped = anchors

    if (tr.docChanged) {
      mapped = anchors
        .map((a) => ({
          ...a,
          from: tr.changes.mapPos(a.from, -1),
          to: tr.changes.mapPos(a.to, 1),
        }))
        .filter((a) => a.from < a.to)
    }

    for (const effect of tr.effects) {
      if (effect.is(setAnchors)) {
        mapped = effect.value
      }
    }

    return mapped
  },
})

/* v8 ignore start */
function buildAnchorDecorations(anchors: CommentAnchor[]): DecorationSet {
  if (anchors.length === 0) return Decoration.none

  const sorted = [...anchors].sort((a, b) => a.from - b.from || a.to - b.to)
  const builder = new RangeSetBuilder<Decoration>()

  for (const anchor of sorted) {
    if (anchor.from >= anchor.to) continue
    builder.add(
      anchor.from,
      anchor.to,
      Decoration.mark({
        class: 'notepad-comment-anchor',
        attributes: { 'data-comment-id': anchor.id },
      })
    )
  }

  return builder.finish()
}

export const commentAnchorDecorations = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet

    constructor(view: EditorView) {
      this.decorations = buildAnchorDecorations(view.state.field(commentAnchorField))
    }

    update(update: ViewUpdate) {
      const prevAnchors = update.startState.field(commentAnchorField)
      const nextAnchors = update.state.field(commentAnchorField)
      if (update.docChanged || prevAnchors !== nextAnchors) {
        this.decorations = buildAnchorDecorations(nextAnchors)
      }
    }
  },
  { decorations: (v) => v.decorations }
)
/* v8 ignore stop */
