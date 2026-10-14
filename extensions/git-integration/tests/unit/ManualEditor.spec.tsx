import { render, screen, fireEvent, act } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'
import React from 'react'
import { EditorView } from '@codemirror/view'
import { ManualEditor } from '../../src/components/merge-flow/ManualEditor'

function makeBlock(overrides: Record<string, unknown> = {}) {
  return {
    blockId: 'src/foo.ts#0',
    index: 0,
    oursText: 'ours',
    theirsText: 'theirs',
    baseText: '',
    contextBefore: [],
    contextAfter: [],
    originalConflictText: '<<<<<<< HEAD\nours\n=======\ntheirs\n>>>>>>> branch',
    isResolved: false,
    ...overrides,
  }
}

function renderEditor(
  block: Record<string, unknown>,
  props: { onSave?: () => void; onCancel?: () => void; suggestedText?: string | null } = {}
) {
  const onSave = props.onSave ?? vi.fn()
  const onCancel = props.onCancel ?? vi.fn()
  const view = render(
    <ManualEditor
      block={block as never}
      onSave={onSave}
      onCancel={onCancel}
      suggestedText={props.suggestedText}
    />
  )
  return { ...view, onSave, onCancel }
}

function editorView(container: HTMLElement): EditorView {
  const content = container.querySelector('.cm-content') as HTMLElement
  return EditorView.findFromDOM(content.parentElement!.parentElement as HTMLElement)!
}

function documentText(container: HTMLElement): string {
  return editorView(container).state.doc.toString()
}

function replaceDocument(container: HTMLElement, text: string) {
  const view = editorView(container)
  act(() => {
    view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: text } })
  })
}

describe('ManualEditor', () => {
  it('pre-populates with ours when ours is longer', () => {
    const { container } = renderEditor(
      makeBlock({ oursText: 'longer ours text', theirsText: 'short' })
    )
    expect(documentText(container)).toBe('longer ours text')
  })

  it('pre-populates with theirs when theirs is longer', () => {
    const { container } = renderEditor(
      makeBlock({ oursText: 'short', theirsText: 'much longer theirs text here' })
    )
    expect(documentText(container)).toBe('much longer theirs text here')
  })

  it('pre-populates with theirs when both are equal length', () => {
    const { container } = renderEditor(makeBlock({ oursText: 'abc', theirsText: 'xyz' }))
    expect(documentText(container)).toBe('xyz')
  })
})

describe('ManualEditor — strips conflict markers from pre-populated content', () => {
  it('strips conflict markers from pre-populated content', () => {
    const { container } = renderEditor(
      makeBlock({
        oursText: '<<<<<<< HEAD\nconst a = 1\n=======',
        theirsText: 'const b = 2',
      })
    )
    expect(documentText(container)).toBe('const a = 1\n')
  })

  it('pre-populates with resolvedText when block is already resolved', () => {
    const { container } = renderEditor(
      makeBlock({ isResolved: true, resolvedText: 'previously resolved text' })
    )
    expect(documentText(container)).toBe('previously resolved text')
  })

  it('passes the unedited pre-fill to onSave', () => {
    const { onSave } = renderEditor(
      makeBlock({ oursText: 'short', theirsText: 'longer theirs text' })
    )
    fireEvent.click(screen.getByRole('button', { name: /Save/i }))
    expect(onSave).toHaveBeenCalledWith('longer theirs text')
  })
})

describe('ManualEditor — passes the edited document to onSave', () => {
  it('passes the edited document to onSave', () => {
    const { container, onSave } = renderEditor(makeBlock())
    replaceDocument(container, 'my custom edit')
    fireEvent.click(screen.getByRole('button', { name: /Save/i }))
    expect(onSave).toHaveBeenCalledWith('my custom edit')
  })

  it('disables save while the document is blank and re-enables it after typing', () => {
    const { container } = renderEditor(makeBlock())
    const save = screen.getByRole('button', { name: /Save/i }) as HTMLButtonElement
    replaceDocument(container, '   \n')
    expect(save.disabled).toBe(true)
    replaceDocument(container, 'x')
    expect(save.disabled).toBe(false)
  })

  it('shows the line count of the edited document', () => {
    const { container } = renderEditor(makeBlock())
    replaceDocument(container, 'a\nb\nc')
    expect(screen.getByText('3 lines')).toBeTruthy()
  })
})

describe('ManualEditor — calls onCancel, and not onSave, when Cancel is clicked', () => {
  it('calls onCancel, and not onSave, when Cancel is clicked', () => {
    const { onSave, onCancel } = renderEditor(makeBlock())
    fireEvent.click(screen.getByText(/Cancel/i))
    expect(onCancel).toHaveBeenCalledOnce()
    expect(onSave).not.toHaveBeenCalled()
  })

  it('replaces the document when a suggested text arrives', () => {
    const block = makeBlock()
    const { container, rerender, onSave } = renderEditor(block, { suggestedText: null })
    rerender(
      <ManualEditor
        block={block as never}
        onSave={onSave}
        onCancel={vi.fn()}
        suggestedText="kept mine"
      />
    )
    expect(documentText(container)).toBe('kept mine')
  })
})

describe('ManualEditor (continued)', () => {
  it.each([
    ['src/foo.ts#0', 'TypeScript'],
    ['src/foo.js#0', 'JavaScript'],
    ['README.md#0', 'Plain text'],
  ])('labels %s as %s', (blockId, label) => {
    renderEditor(makeBlock({ blockId }))
    expect(screen.getByText(label)).toBeTruthy()
  })
})
