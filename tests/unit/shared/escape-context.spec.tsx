import { describe, it, expect } from 'vitest'
import { escapeContextFromTarget } from '../../../src/shared/double-escape'

// Lives in a .tsx spec so it runs under the jsdom project: it inspects real DOM
// nodes, and the sibling double-escape.spec.ts is pure and runs under node.

describe('escapeContextFromTarget', () => {
  it('reports a text input', () => {
    const input = document.createElement('input')
    expect(escapeContextFromTarget(input, document).inTextField).toBe(true)
  })

  it('reports a textarea', () => {
    expect(escapeContextFromTarget(document.createElement('textarea'), document).inTextField).toBe(
      true
    )
  })

  it('reports a contenteditable element', () => {
    const el = document.createElement('div')
    el.setAttribute('contenteditable', 'true')
    // jsdom does not implement isContentEditable, so the attribute is the signal.
    expect(escapeContextFromTarget(el, document).inTextField).toBe(true)
  })

  it('reports an element inside a terminal', () => {
    const term = document.createElement('div')
    term.className = 'xterm'
    const child = document.createElement('span')
    term.appendChild(child)
    expect(escapeContextFromTarget(child, document).inTerminal).toBe(true)
  })
})

describe('escapeContextFromTarget — plain elements, modals and null', () => {
  it('reports a plain element as neither', () => {
    const ctx = escapeContextFromTarget(document.createElement('div'), document)
    expect(ctx.inTextField).toBe(false)
    expect(ctx.inTerminal).toBe(false)
  })

  it('reports no open surface on a bare page', () => {
    expect(escapeContextFromTarget(document.createElement('div'), document).surfaceOpen).toBe(false)
  })

  it('reports an open modal dialog and an open popover', () => {
    const dialog = document.body.appendChild(document.createElement('dialog'))
    dialog.showModal()
    expect(escapeContextFromTarget(null, document).surfaceOpen).toBe(true)
    dialog.close()
    dialog.remove()
    const popover = document.body.appendChild(document.createElement('div'))
    popover.setAttribute('popover', 'auto')
    popover.showPopover()
    expect(escapeContextFromTarget(null, document).surfaceOpen).toBe(true)
    popover.hidePopover()
    expect(escapeContextFromTarget(null, document).surfaceOpen).toBe(false)
    popover.remove()
  })

  it('tolerates a null target', () => {
    const ctx = escapeContextFromTarget(null, document)
    expect(ctx.inTextField).toBe(false)
    expect(ctx.inTerminal).toBe(false)
  })
})
