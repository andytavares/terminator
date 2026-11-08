import { render, screen, act } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
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

function editorView(): EditorView {
  return EditorView.findFromDOM(screen.getByRole('textbox'))!
}

function documentText(): string {
  return editorView().state.doc.toString()
}

function replaceDocument(text: string) {
  const view = editorView()
  act(() => {
    view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: text } })
  })
}

describe('ManualEditor', () => {
  it.each([
    { oursText: 'longer ours text', theirsText: 'short', expected: 'longer ours text' },
    {
      oursText: 'short',
      theirsText: 'much longer theirs text',
      expected: 'much longer theirs text',
    },
    { oursText: 'abc', theirsText: 'xyz', expected: 'xyz' },
  ])(
    'pre-populates with the longer side, theirs on a tie ($oursText / $theirsText)',
    ({ oursText, theirsText, expected }) => {
      renderEditor(makeBlock({ oursText, theirsText }))
      expect(documentText()).toBe(expected)
    }
  )
})

describe('ManualEditor — strips conflict markers from pre-populated content', () => {
  it('strips conflict markers from pre-populated content', () => {
    renderEditor(
      makeBlock({
        oursText: '<<<<<<< HEAD\nconst a = 1\n=======',
        theirsText: 'const b = 2',
      })
    )
    expect(documentText()).toBe('const a = 1\n')
  })

  it('pre-populates with resolvedText when block is already resolved', () => {
    renderEditor(makeBlock({ isResolved: true, resolvedText: 'previously resolved text' }))
    expect(documentText()).toBe('previously resolved text')
  })

  it('passes the unedited pre-fill to onSave', async () => {
    const user = userEvent.setup()
    const { onSave } = renderEditor(
      makeBlock({ oursText: 'short', theirsText: 'longer theirs text' })
    )
    await user.click(screen.getByRole('button', { name: /Save/i }))
    expect(onSave).toHaveBeenCalledWith('longer theirs text')
  })
})

describe('ManualEditor — passes the edited document to onSave', () => {
  it('passes the edited document to onSave', async () => {
    const user = userEvent.setup()
    const { onSave } = renderEditor(makeBlock())
    replaceDocument('my custom edit')
    await user.click(screen.getByRole('button', { name: /Save/i }))
    expect(onSave).toHaveBeenCalledWith('my custom edit')
  })

  it('disables save while the document is blank and re-enables it after typing', () => {
    renderEditor(makeBlock())
    const save = screen.getByRole('button', { name: /Save/i }) as HTMLButtonElement
    replaceDocument('   \n')
    expect(save.disabled).toBe(true)
    replaceDocument('x')
    expect(save.disabled).toBe(false)
  })

  it('shows the line count of the edited document', () => {
    renderEditor(makeBlock())
    replaceDocument('a\nb\nc')
    expect(screen.getByText('3 lines')).toBeTruthy()
  })
})

describe('ManualEditor — calls onCancel, and not onSave, when Cancel is clicked', () => {
  it('calls onCancel, and not onSave, when Cancel is clicked', async () => {
    const user = userEvent.setup()
    const { onSave, onCancel } = renderEditor(makeBlock())
    await user.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(onCancel).toHaveBeenCalledOnce()
    expect(onSave).not.toHaveBeenCalled()
  })

  it('replaces the document when a suggested text arrives', () => {
    const block = makeBlock()
    const { rerender, onSave } = renderEditor(block, { suggestedText: null })
    rerender(
      <ManualEditor
        block={block as never}
        onSave={onSave}
        onCancel={vi.fn()}
        suggestedText="kept mine"
      />
    )
    expect(documentText()).toBe('kept mine')
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
