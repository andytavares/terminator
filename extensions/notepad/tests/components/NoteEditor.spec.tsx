import { describe, it, expect, vi } from 'vitest'
import { render } from '@testing-library/react'
import React from 'react'

vi.mock('@codemirror/view', () => {
  const EditorView = vi.fn().mockImplementation(({ parent }: { parent: Element }) => {
    const el = document.createElement('div')
    el.className = 'cm-editor'
    parent?.appendChild(el)
    return {
      destroy: vi.fn(),
      state: { doc: { toString: () => '' } },
      dispatch: vi.fn(),
    }
  })
  // Static methods that NoteEditor uses
  ;(EditorView as unknown as Record<string, unknown>).updateListener = { of: vi.fn(() => ({})) }
  ;(EditorView as unknown as Record<string, unknown>).theme = vi.fn(() => ({}))
  ;(EditorView as unknown as Record<string, unknown>).lineWrapping = {}
  return {
    EditorView,
    keymap: { of: vi.fn(() => ({})) },
    ViewPlugin: { fromClass: vi.fn(() => ({})) },
  }
})

vi.mock('@codemirror/state', () => ({
  EditorState: {
    create: vi.fn().mockReturnValue({}),
    readOnly: { of: vi.fn(() => ({})) },
  },
  Compartment: vi.fn().mockImplementation(() => ({
    of: vi.fn(() => ({})),
    reconfigure: vi.fn(() => ({})),
  })),
  RangeSetBuilder: vi.fn().mockImplementation(() => ({ add: vi.fn(), finish: vi.fn(() => ({})) })),
  StateField: { define: vi.fn(() => ({})) },
  StateEffect: { define: vi.fn(() => ({ of: vi.fn() })) },
}))

vi.mock('@codemirror/lang-markdown', () => ({ markdown: vi.fn(() => ({})) }))
vi.mock('@lezer/markdown', () => ({ GFM: {} }))
vi.mock('@codemirror/lang-javascript', () => ({ javascript: vi.fn(() => ({})) }))
vi.mock('@codemirror/lang-css', () => ({ css: vi.fn(() => ({})) }))
vi.mock('@codemirror/lang-html', () => ({ html: vi.fn(() => ({})) }))
vi.mock('@codemirror/lang-python', () => ({ python: vi.fn(() => ({})) }))
vi.mock('@codemirror/lang-java', () => ({ java: vi.fn(() => ({})) }))
vi.mock('@codemirror/lang-json', () => ({ json: vi.fn(() => ({})) }))
vi.mock('@codemirror/lang-cpp', () => ({ cpp: vi.fn(() => ({})) }))
vi.mock('@codemirror/lang-yaml', () => ({ yaml: vi.fn(() => ({})) }))
vi.mock('@codemirror/legacy-modes/mode/go', () => ({ go: {} }))
vi.mock('@codemirror/legacy-modes/mode/shell', () => ({ shell: {} }))

vi.mock('@codemirror/commands', () => ({
  defaultKeymap: [],
  historyKeymap: [],
  history: vi.fn(() => ({})),
  indentWithTab: {},
}))

vi.mock('@codemirror/search', () => ({ searchKeymap: [] }))

vi.mock('@codemirror/language', () => ({
  syntaxTree: vi.fn(() => ({ iterate: vi.fn() })),
  LanguageDescription: { of: vi.fn(() => ({})) },
  StreamLanguage: { define: vi.fn(() => ({})) },
  syntaxHighlighting: vi.fn(() => ({})),
}))
vi.mock('@codemirror/theme-one-dark', () => ({ oneDarkHighlightStyle: {} }))

vi.mock('../../src/editor/livePreview', () => ({ livePreviewPlugin: {} }))
vi.mock('../../src/editor/highlightOverlay', () => ({ highlightOverlayPlugin: {} }))

vi.mock('../../src/editor/commentField', () => ({
  commentAnchorField: {},
  commentAnchorDecorations: {},
  setAnchors: { of: vi.fn() },
  hoveredAnchorField: {},
  setHoveredAnchor: { of: vi.fn() },
}))

import {
  NoteEditor,
  applyAnchors,
  setEditorHoverAnchor,
  scrollToAnchor,
} from '../../src/editor/NoteEditor'
import type { EditorView } from '@codemirror/view'

describe('NoteEditor', () => {
  it('renders the editor container div', () => {
    const { container } = render(<NoteEditor initialDoc="# Test" onChange={vi.fn()} />)
    expect(container.querySelector('.notepad-editor-cm')).toBeTruthy()
  })

  it('does not call onChange on initial mount', () => {
    const onChange = vi.fn()
    render(<NoteEditor initialDoc="hello" onChange={onChange} />)
    expect(onChange).not.toHaveBeenCalled()
  })

  it('calls onAnchorsReady with a getter function', () => {
    const onAnchorsReady = vi.fn()
    render(<NoteEditor initialDoc="hello" onChange={vi.fn()} onAnchorsReady={onAnchorsReady} />)
    expect(onAnchorsReady).toHaveBeenCalledWith(expect.any(Function))
  })
})

describe('applyAnchors', () => {
  it('calls view.dispatch with setAnchors effect', () => {
    const mockView = { dispatch: vi.fn() } as unknown as EditorView
    applyAnchors(mockView, [{ id: 'c1', from: 0, to: 5 }])
    expect(mockView.dispatch).toHaveBeenCalledWith({ effects: expect.any(Array) })
  })

  it('does nothing when view is null', () => {
    expect(() => applyAnchors(null, [])).not.toThrow()
  })
})

describe('setEditorHoverAnchor', () => {
  it('dispatches setHoveredAnchor effect', () => {
    const mockView = { dispatch: vi.fn() } as unknown as EditorView
    setEditorHoverAnchor(mockView, 'c1')
    expect(mockView.dispatch).toHaveBeenCalledWith({ effects: expect.any(Array) })
  })

  it('does nothing when view is null', () => {
    expect(() => setEditorHoverAnchor(null, null)).not.toThrow()
  })
})

describe('scrollToAnchor', () => {
  it('dispatches selection and focuses the view', () => {
    const mockView = { dispatch: vi.fn(), focus: vi.fn() } as unknown as EditorView
    scrollToAnchor(mockView, 5, 10)
    expect(mockView.dispatch).toHaveBeenCalledWith({
      selection: { anchor: 5, head: 10 },
      scrollIntoView: true,
    })
    expect(mockView.focus).toHaveBeenCalled()
  })

  it('does nothing when view is null', () => {
    expect(() => scrollToAnchor(null, 0, 5)).not.toThrow()
  })
})
