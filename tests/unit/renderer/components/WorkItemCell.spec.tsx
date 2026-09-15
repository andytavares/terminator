import React from 'react'
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { WorkItemCell } from '../../../../src/renderer/components/session/WorkItemCell'
import type { Issue } from '../../../../src/shared/types/index'

const ISSUE = { tracker: 'linear', key: 'NW-88', title: 'Rate limit per API key' } as Issue
const WORK_ITEM = { source: 'project' as const, ref: { tracker: 'linear' as const, key: 'NW-88' } }

const noop = () => {}

describe('WorkItemCell — a linked ticket', () => {
  it('shows the key and the title', () => {
    render(
      <WorkItemCell
        workItem={WORK_ITEM}
        issue={ISSUE}
        description={null}
        onSaveDescription={noop}
      />
    )
    expect(screen.getByText('NW-88')).toBeTruthy()
    expect(screen.getByText('Rate limit per API key')).toBeTruthy()
  })

  it('still shows the key when the details could not be read', () => {
    render(
      <WorkItemCell workItem={WORK_ITEM} issue={null} description={null} onSaveDescription={noop} />
    )
    expect(screen.getByText('NW-88')).toBeTruthy()
    expect(screen.getByText('Details unavailable')).toBeTruthy()
  })

  it('shows only the key while the details load', () => {
    render(
      <WorkItemCell
        workItem={WORK_ITEM}
        issue={undefined}
        description="ignored while a ticket is shown"
        onSaveDescription={noop}
      />
    )
    expect(screen.getByText('NW-88')).toBeTruthy()
    expect(screen.queryByText('Details unavailable')).toBeNull()
    expect(screen.queryByText('ignored while a ticket is shown')).toBeNull()
  })
})

describe('WorkItemCell — a description', () => {
  it('shows the first line and offers to edit it', () => {
    render(
      <WorkItemCell
        workItem={null}
        issue={undefined}
        description={'Moving kitty config to Ghostty\nkeybinds half done'}
        onSaveDescription={noop}
      />
    )
    expect(screen.getByText('Moving kitty config to Ghostty')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Edit description' })).toBeTruthy()
  })

  it('edits and saves', () => {
    const save = vi.fn()
    render(
      <WorkItemCell workItem={null} issue={undefined} description="old" onSaveDescription={save} />
    )
    fireEvent.click(screen.getByRole('button', { name: 'Edit description' }))
    const box = screen.getByRole('textbox', { name: 'What is this session doing?' })
    expect((box as HTMLInputElement).value).toBe('old')
    fireEvent.change(box, { target: { value: 'new' } })
    fireEvent.keyDown(box, { key: 'Enter' })
    expect(save).toHaveBeenCalledWith('new')
  })

  it('saves a cleared description as null', () => {
    const save = vi.fn()
    render(
      <WorkItemCell workItem={null} issue={undefined} description="old" onSaveDescription={save} />
    )
    fireEvent.click(screen.getByRole('button', { name: 'Edit description' }))
    const box = screen.getByRole('textbox', { name: 'What is this session doing?' })
    fireEvent.change(box, { target: { value: '   ' } })
    fireEvent.keyDown(box, { key: 'Enter' })
    expect(save).toHaveBeenCalledWith(null)
  })

  it('cannot be edited when read-only', () => {
    render(
      <WorkItemCell
        workItem={null}
        issue={undefined}
        description="closed session"
        readOnly
        onSaveDescription={noop}
      />
    )
    expect(screen.queryByRole('button', { name: 'Edit description' })).toBeNull()
  })
})

describe('WorkItemCell — nothing yet', () => {
  it('asks what the session is doing', () => {
    render(
      <WorkItemCell workItem={null} issue={undefined} description={null} onSaveDescription={noop} />
    )
    const box = screen.getByRole('textbox', { name: 'What is this session doing?' })
    expect(box.getAttribute('maxlength')).toBe('500')
  })

  it('saves on Enter, trimmed', () => {
    const save = vi.fn()
    render(
      <WorkItemCell workItem={null} issue={undefined} description={null} onSaveDescription={save} />
    )
    const box = screen.getByRole('textbox', { name: 'What is this session doing?' })
    fireEvent.change(box, { target: { value: '  Checking bundle size  ' } })
    fireEvent.keyDown(box, { key: 'Enter' })
    expect(save).toHaveBeenCalledWith('Checking bundle size')
  })

  it('does not save an empty field', () => {
    const save = vi.fn()
    render(
      <WorkItemCell workItem={null} issue={undefined} description={null} onSaveDescription={save} />
    )
    fireEvent.keyDown(screen.getByRole('textbox', { name: 'What is this session doing?' }), {
      key: 'Enter',
    })
    expect(save).not.toHaveBeenCalled()
  })

  it('reverts on Escape without saving', () => {
    const save = vi.fn()
    render(
      <WorkItemCell workItem={null} issue={undefined} description={null} onSaveDescription={save} />
    )
    const box = screen.getByRole('textbox', {
      name: 'What is this session doing?',
    }) as HTMLInputElement
    fireEvent.change(box, { target: { value: 'half typed' } })
    fireEvent.keyDown(box, { key: 'Escape' })
    expect(box.value).toBe('')
    expect(save).not.toHaveBeenCalled()
  })

  it('does not bubble its keys to a surrounding row', () => {
    const rowKey = vi.fn()
    render(
      <div onKeyDown={rowKey}>
        <WorkItemCell
          workItem={null}
          issue={undefined}
          description={null}
          onSaveDescription={noop}
        />
      </div>
    )
    fireEvent.keyDown(screen.getByRole('textbox', { name: 'What is this session doing?' }), {
      key: 'Enter',
    })
    expect(rowKey).not.toHaveBeenCalled()
  })

  it('offers a link only when linking is possible here', () => {
    const { rerender } = render(
      <WorkItemCell workItem={null} issue={undefined} description={null} onSaveDescription={noop} />
    )
    expect(screen.queryByRole('button', { name: 'Link a work item' })).toBeNull()
    const link = vi.fn()
    rerender(
      <WorkItemCell
        workItem={null}
        issue={undefined}
        description={null}
        onSaveDescription={noop}
        onLink={link}
      />
    )
    fireEvent.click(screen.getByRole('button', { name: 'Link a work item' }))
    expect(link).toHaveBeenCalled()
  })
})
