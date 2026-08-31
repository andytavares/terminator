import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, fireEvent, screen, cleanup, act } from '@testing-library/react'
import React from 'react'
import { useEditorStore } from '../../src/stores/editor.store'
import { NoteOutline } from '../../src/components/NoteOutline'

const BODY = ['# Title', 'intro', '## Setup', '### Install', '## Usage'].join('\n')

function setBody(body: string) {
  useEditorStore.setState({ activeNoteId: 'n1', bodyDraft: body })
}

function depths(container: HTMLElement): string[] {
  return [...container.querySelectorAll<HTMLElement>('.notepad-outline__item')].map((el) =>
    el.style.getPropertyValue('--outline-depth')
  )
}

describe('NoteOutline', () => {
  beforeEach(() => {
    cleanup()
    setBody('')
  })

  it('lists every heading in the open note', () => {
    setBody(BODY)
    render(<NoteOutline onSelect={vi.fn()} onClose={vi.fn()} />)
    for (const text of ['Title', 'Setup', 'Install', 'Usage']) {
      expect(screen.getByText(text)).toBeTruthy()
    }
  })

  it('nests each heading under the one above it', () => {
    setBody(BODY)
    const { container } = render(<NoteOutline onSelect={vi.fn()} onClose={vi.fn()} />)
    expect(depths(container)).toEqual(['0', '1', '2', '1'])
  })

  it('does not waste an indent level on a note that starts below h1', () => {
    setBody('## Setup\n### Install')
    const { container } = render(<NoteOutline onSelect={vi.fn()} onClose={vi.fn()} />)
    expect(depths(container)).toEqual(['0', '1'])
  })

  it('reports the heading offset when one is clicked', () => {
    setBody(BODY)
    const onSelect = vi.fn()
    render(<NoteOutline onSelect={onSelect} onClose={vi.fn()} />)
    fireEvent.click(screen.getByText('Usage'))
    expect(onSelect).toHaveBeenCalledWith(BODY.indexOf('## Usage'))
  })

  it('says the note has no headings rather than showing an empty panel', () => {
    setBody('just prose')
    render(<NoteOutline onSelect={vi.fn()} onClose={vi.fn()} />)
    expect(screen.getByText(/no headings/i)).toBeTruthy()
  })

  it('counts the headings on the header', () => {
    setBody(BODY)
    render(<NoteOutline onSelect={vi.fn()} onClose={vi.fn()} />)
    expect(screen.getByText('4')).toBeTruthy()
  })

  it('closes from its own header, without reaching for the toolbar', () => {
    setBody(BODY)
    const onClose = vi.fn()
    render(<NoteOutline onSelect={vi.fn()} onClose={onClose} />)
    fireEvent.click(screen.getByRole('button', { name: /close outline/i }))
    expect(onClose).toHaveBeenCalledOnce()
  })

  it('follows the body as it is edited', () => {
    setBody('# One')
    const { container } = render(<NoteOutline onSelect={vi.fn()} onClose={vi.fn()} />)
    expect(container.querySelectorAll('.notepad-outline__item')).toHaveLength(1)

    act(() => setBody('# One\n## Two'))
    expect(container.querySelectorAll('.notepad-outline__item')).toHaveLength(2)
  })
})
