/* v8 ignore start */
import { ViewPlugin, type ViewUpdate, EditorView } from '@codemirror/view'
import { commentAnchorField, hoveredAnchorField } from './commentField'

const VERT_EXTEND = 4

function renderSpansForAnchor(
  anchorId: string,
  view: EditorView,
  scrollerRect: DOMRect,
  scrollTop: number,
  scrollLeft: number,
  wrapper: HTMLDivElement
) {
  const spans = Array.from(
    view.dom.querySelectorAll(`[data-comment-id="${anchorId}"]`)
  ) as HTMLElement[]

  for (const span of spans) {
    const spanRect = span.getBoundingClientRect()
    if (spanRect.width <= 0 || spanRect.height <= 0) continue

    const left = spanRect.left - scrollerRect.left + scrollLeft
    const width = spanRect.width
    const top = spanRect.top - scrollerRect.top + scrollTop - VERT_EXTEND
    const height = spanRect.height + VERT_EXTEND * 2

    const div = document.createElement('div')
    div.style.cssText = [
      'position:absolute',
      `top:${top}px`,
      `left:${left}px`,
      `width:${width}px`,
      `height:${height}px`,
      'background:rgb(250,210,50)',
      'pointer-events:none',
    ].join(';')
    wrapper.appendChild(div)
  }
}

export const highlightOverlayPlugin = ViewPlugin.fromClass(
  class {
    container: HTMLDivElement
    wrapper: HTMLDivElement

    constructor(view: EditorView) {
      this.container = document.createElement('div')
      this.container.style.cssText =
        'position:absolute;top:0;left:0;right:0;bottom:0;pointer-events:none;z-index:0'
      view.scrollDOM.prepend(this.container)

      this.wrapper = document.createElement('div')
      this.wrapper.style.cssText =
        'position:absolute;top:0;left:0;right:0;bottom:0;opacity:0.35;pointer-events:none'
      this.container.appendChild(this.wrapper)

      this.render(view)
    }

    render(view: EditorView) {
      const anchors = view.state.field(commentAnchorField)
      const hoveredId = view.state.field(hoveredAnchorField)

      this.wrapper.innerHTML = ''

      // Toggle underline class on hovered anchor's spans only
      view.dom.querySelectorAll('.notepad-comment-anchor--hover').forEach((el) => {
        el.classList.remove('notepad-comment-anchor--hover')
      })
      if (hoveredId) {
        view.dom.querySelectorAll(`[data-comment-id="${hoveredId}"]`).forEach((el) => {
          el.classList.add('notepad-comment-anchor--hover')
        })
      }

      if (anchors.length === 0) return

      const scrollerRect = view.scrollDOM.getBoundingClientRect()
      const scrollTop = view.scrollDOM.scrollTop
      const scrollLeft = view.scrollDOM.scrollLeft

      for (const anchor of anchors) {
        if (anchor.from >= anchor.to) continue
        renderSpansForAnchor(anchor.id, view, scrollerRect, scrollTop, scrollLeft, this.wrapper)
      }
    }

    update(update: ViewUpdate) {
      if (
        update.docChanged ||
        update.viewportChanged ||
        update.geometryChanged ||
        update.startState.field(commentAnchorField) !== update.state.field(commentAnchorField) ||
        update.startState.field(hoveredAnchorField) !== update.state.field(hoveredAnchorField)
      ) {
        this.render(update.view)
      }
    }

    destroy() {
      this.container.remove()
    }
  }
)
/* v8 ignore stop */
