import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import React from 'react'
import { CardBriefEditor } from '../../src/components/CardBriefEditor.js'

describe('CardBriefEditor', () => {
  it('disables submit until a title is entered', () => {
    render(<CardBriefEditor onSubmit={vi.fn()} submitLabel="Create" />)
    const submit = screen.getByText('Create') as HTMLButtonElement
    expect(submit.disabled).toBe(true)
    expect(screen.getByText(/title is required/i)).toBeTruthy()
    fireEvent.change(screen.getByLabelText('Card title'), { target: { value: 'My card' } })
    expect(submit.disabled).toBe(false)
  })

  it('submits the brief with title, type, scope', () => {
    const onSubmit = vi.fn()
    render(<CardBriefEditor onSubmit={onSubmit} submitLabel="Create" />)
    fireEvent.change(screen.getByLabelText('Card title'), { target: { value: 'Fix bug' } })
    fireEvent.click(screen.getByRole('radio', { name: 'bug' }))
    fireEvent.change(screen.getByLabelText('Card scope'), { target: { value: 'Only the API' } })
    fireEvent.click(screen.getByText('Create'))
    expect(onSubmit).toHaveBeenCalledWith(
      expect.objectContaining({ title: 'Fix bug', type: 'bug', scope: 'Only the API' })
    )
  })

  it('adds and removes checklist items', () => {
    const onSubmit = vi.fn()
    render(<CardBriefEditor onSubmit={onSubmit} submitLabel="Save" />)
    fireEvent.change(screen.getByLabelText('Card title'), { target: { value: 'T' } })
    fireEvent.change(screen.getByLabelText('New checklist item'), {
      target: { value: 'Write tests' },
    })
    fireEvent.click(screen.getByLabelText('Add checklist item'))
    expect(screen.getByText('Write tests')).toBeTruthy()
    fireEvent.click(screen.getByLabelText('Remove Write tests'))
    expect(screen.queryByText('Write tests')).toBeNull()
  })

  it('prefills from an initial brief', () => {
    render(
      <CardBriefEditor
        initial={{ title: 'Existing', type: 'chore', scope: 'S' }}
        onSubmit={vi.fn()}
      />
    )
    expect((screen.getByLabelText('Card title') as HTMLInputElement).value).toBe('Existing')
    expect(screen.getByRole('radio', { name: 'chore' }).getAttribute('aria-checked')).toBe('true')
  })
})
