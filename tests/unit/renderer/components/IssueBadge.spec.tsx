import React from 'react'
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { IssueBadge } from '../../../../src/renderer/components/integrations/IssueBadge'
import type { IssueStateType } from '../../../../src/shared/types/index'

function state(type: IssueStateType, name = 'Some state') {
  return { name, type }
}

describe('IssueBadge — what it shows', () => {
  it('shows the issue key', () => {
    render(
      <IssueBadge tracker="linear" issueKey="TAV-42" state={state('started', 'In Progress')} />
    )
    expect(screen.getByText('TAV-42')).toBeTruthy()
  })

  it('names the tracker, the state and the title on hover', () => {
    render(
      <IssueBadge
        tracker="jira"
        issueKey="TAV-7"
        state={state('started', 'In Progress')}
        title="Move Jira behind the shared connection"
      />
    )
    const label = screen.getByRole('button').getAttribute('title') ?? ''
    expect(label).toContain('TAV-7')
    expect(label).toContain('Jira')
    expect(label).toContain('In Progress')
    expect(label).toContain('Move Jira behind')
  })

  it('reads the same to a screen reader as it does on hover', () => {
    render(<IssueBadge tracker="linear" issueKey="TAV-42" state={state('completed', 'Done')} />)
    const button = screen.getByRole('button')
    expect(button.getAttribute('aria-label')).toBe(button.getAttribute('title'))
  })

  it('copes with an issue that has no title', () => {
    render(<IssueBadge tracker="linear" issueKey="TAV-42" state={state('backlog', 'Backlog')} />)
    expect(screen.getByRole('button').getAttribute('title')).toBe('TAV-42 · Linear — Backlog')
  })
})

describe('IssueBadge — state without colour (FR-009)', () => {
  it.each([
    ['backlog', 'open'],
    ['unstarted', 'open'],
    ['started', 'active'],
    ['completed', 'closed'],
    ['canceled', 'closed'],
  ] as const)('maps %s to the %s weight', (type, weight) => {
    const { container } = render(
      <IssueBadge tracker="linear" issueKey="TAV-1" state={state(type)} />
    )
    expect(container.querySelector(`.issue-badge__dot--${weight}`)).toBeTruthy()
  })

  it('carries the state as text too, so colour is never the only signal', () => {
    render(<IssueBadge tracker="linear" issueKey="TAV-1" state={state('started', 'In Progress')} />)
    // The dot is decorative; the accessible name carries the meaning.
    const dot = document.querySelector('.issue-badge__dot')
    expect(dot?.getAttribute('aria-hidden')).toBe('true')
    expect(screen.getByRole('button').getAttribute('aria-label')).toContain('In Progress')
  })
})

describe('IssueBadge — unavailable', () => {
  it('marks an issue it could not read, rather than vanishing', () => {
    const { container } = render(<IssueBadge tracker="linear" issueKey="TAV-42" state={null} />)
    expect(screen.getByText('TAV-42')).toBeTruthy()
    expect(container.querySelector('.issue-badge--unavailable')).toBeTruthy()
    expect(screen.getByRole('button').getAttribute('title')).toContain('Unavailable')
  })
})

describe('IssueBadge — interaction', () => {
  it('calls its handler', () => {
    const onClick = vi.fn()
    render(
      <IssueBadge tracker="linear" issueKey="TAV-42" state={state('started')} onClick={onClick} />
    )
    fireEvent.click(screen.getByRole('button'))
    expect(onClick).toHaveBeenCalledTimes(1)
  })

  it('does not let the click reach the project header underneath it', () => {
    const parentClick = vi.fn()
    render(
      <div onClick={parentClick}>
        <IssueBadge tracker="linear" issueKey="TAV-42" state={state('started')} />
      </div>
    )
    fireEvent.click(screen.getByRole('button'))
    expect(parentClick).not.toHaveBeenCalled()
  })

  it('is harmless with no handler', () => {
    render(<IssueBadge tracker="linear" issueKey="TAV-42" state={state('started')} />)
    expect(() => fireEvent.click(screen.getByRole('button'))).not.toThrow()
  })
})
