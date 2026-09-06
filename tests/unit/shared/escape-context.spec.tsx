import { describe, it, expect } from 'vitest'
import { escapeContextFromTarget } from '../../../src/shared/double-escape'

// Lives in a .tsx spec so it runs under the jsdom project: it inspects real DOM
// nodes, and the sibling double-escape.spec.ts is pure and runs under node.

describe('escapeContextFromTarget', () => {
  it('reports a text input', () => {
    const input = document.createElement('input')
    expect(escapeContextFromTarget(input, 0).inTextField).toBe(true)
  })

  it('reports a textarea', () => {
    expect(escapeContextFromTarget(document.createElement('textarea'), 0).inTextField).toBe(true)
  })

  it('reports a contenteditable element', () => {
    const el = document.createElement('div')
    el.setAttribute('contenteditable', 'true')
    // jsdom does not implement isContentEditable, so the attribute is the signal.
    expect(escapeContextFromTarget(el, 0).inTextField).toBe(true)
  })

  it('reports an element inside a terminal', () => {
    const term = document.createElement('div')
    term.className = 'xterm'
    const child = document.createElement('span')
    term.appendChild(child)
    expect(escapeContextFromTarget(child, 0).inTerminal).toBe(true)
  })

  it('reports a plain element as neither', () => {
    const ctx = escapeContextFromTarget(document.createElement('div'), 0)
    expect(ctx.inTextField).toBe(false)
    expect(ctx.inTerminal).toBe(false)
  })

  it('carries the modal depth through', () => {
    expect(escapeContextFromTarget(document.createElement('div'), 2).modalDepth).toBe(2)
  })

  it('tolerates a null target', () => {
    const ctx = escapeContextFromTarget(null, 0)
    expect(ctx.inTextField).toBe(false)
    expect(ctx.inTerminal).toBe(false)
  })
})
