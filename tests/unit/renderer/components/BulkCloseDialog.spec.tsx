import React from 'react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { BulkCloseDialog } from '../../../../src/renderer/components/sidebar/BulkCloseDialog'
import type { Project, TerminalSession } from '../../../../src/shared/types/index'

const plain: Project = {
  id: 'p1',
  workspaceId: 'w1',
  name: 'API',
  isWorktree: false,
  createdAt: '',
  updatedAt: '',
}
const worktree: Project = {
  id: 'p2',
  workspaceId: 'w1',
  name: 'Feature',
  isWorktree: true,
  worktreePath: '/repo/.worktrees/feat-x',
  createdAt: '',
  updatedAt: '',
}

const projectById = new Map([
  [plain.id, plain],
  [worktree.id, worktree],
])

function session(
  id: string,
  projectId: string,
  patch: Partial<TerminalSession> = {}
): TerminalSession {
  return {
    id,
    projectId,
    tabTitle: id,
    status: 'active',
    type: 'agent',
    scrollbackLimit: 10000,
    createdAt: '',
    lastActivityAt: 0,
    agentState: 'idle',
    ...patch,
  }
}

let onConfirm: ReturnType<typeof vi.fn>
let onClose: ReturnType<typeof vi.fn>

beforeEach(() => {
  onConfirm = vi.fn()
  onClose = vi.fn()
})

const renderDialog = (sessions: TerminalSession[]) =>
  render(
    <BulkCloseDialog
      sessions={sessions}
      projectById={projectById}
      onConfirm={onConfirm}
      onClose={onClose}
    />
  )

describe('BulkCloseDialog — what will happen (FR-024)', () => {
  it('uses the singular when only one session will close', () => {
    renderDialog([session('a', 'p1')])
    expect(screen.getByText('Close 1 session?')).toBeTruthy()
  })

  it('counts and lists exactly the sessions that will close', () => {
    renderDialog([session('a', 'p1'), session('b', 'p1')])
    expect(screen.getByText('Close 2 sessions?')).toBeTruthy()
    expect(screen.getByText('a')).toBeTruthy()
    expect(screen.getByText('b')).toBeTruthy()
  })

  it('confirms with the ids of the sessions it listed', () => {
    renderDialog([session('a', 'p1'), session('b', 'p1')])
    fireEvent.click(screen.getByText('Close sessions'))
    expect(onConfirm).toHaveBeenCalledWith(['a', 'b'], [])
  })

  it('names the exact worktree path that leaves disk before confirming', () => {
    renderDialog([session('a', 'p2')])
    expect(screen.getByText('/repo/.worktrees/feat-x')).toBeTruthy()
    expect(screen.getByText(/removes 1 worktree/)).toBeTruthy()
  })

  it('reports the worktree project so the caller can remove it', () => {
    renderDialog([session('a', 'p2')])
    fireEvent.click(screen.getByText('Close sessions'))
    expect(onConfirm).toHaveBeenCalledWith(['a'], ['p2'])
  })

  it('mentions no worktree when none is worktree-backed', () => {
    renderDialog([session('a', 'p1')])
    expect(screen.queryByText(/removes/)).toBeNull()
  })

  it('lists a worktree once however many of its sessions are selected', () => {
    renderDialog([session('a', 'p2'), session('b', 'p2')])
    expect(screen.getAllByText('/repo/.worktrees/feat-x')).toHaveLength(1)
  })
})

describe('BulkCloseDialog — a session waiting on you is never closed (FR-023, SC-006)', () => {
  it('excludes it from the list and the count', () => {
    renderDialog([session('a', 'p1'), session('waiting', 'p1', { agentState: 'awaiting-input' })])
    expect(screen.getByText('Close 1 session?')).toBeTruthy()
    expect(screen.queryByText('waiting')).toBeNull()
  })

  it('says so, rather than silently dropping it', () => {
    renderDialog([session('a', 'p1'), session('waiting', 'p1', { agentState: 'awaiting-input' })])
    expect(screen.getByText(/1 session waiting on you is excluded/)).toBeTruthy()
  })

  it('never reports it to the caller', () => {
    renderDialog([session('a', 'p1'), session('waiting', 'p1', { agentState: 'awaiting-input' })])
    fireEvent.click(screen.getByText('Close sessions'))
    expect(onConfirm).toHaveBeenCalledWith(['a'], [])
  })

  it('does not remove a worktree whose only selected session is waiting on you', () => {
    renderDialog([session('waiting', 'p2', { agentState: 'awaiting-input' })])
    expect(screen.queryByText('/repo/.worktrees/feat-x')).toBeNull()
  })

  it('disables confirmation when every selected session is waiting on you', () => {
    renderDialog([session('waiting', 'p1', { agentState: 'awaiting-input' })])
    expect((screen.getByText('Close sessions') as HTMLButtonElement).disabled).toBe(true)
  })

  it('pluralises the exclusion note correctly', () => {
    renderDialog([
      session('w1', 'p1', { agentState: 'awaiting-input' }),
      session('w2', 'p1', { agentState: 'awaiting-input' }),
      session('a', 'p1'),
    ])
    expect(screen.getByText(/2 sessions waiting on you are excluded/)).toBeTruthy()
  })
})

describe('BulkCloseDialog — dismissal', () => {
  it('cancels without closing anything', () => {
    renderDialog([session('a', 'p1')])
    fireEvent.click(screen.getByText('Cancel'))
    expect(onClose).toHaveBeenCalledOnce()
    expect(onConfirm).not.toHaveBeenCalled()
  })

  it('dismisses on a backdrop click', () => {
    const { container } = renderDialog([session('a', 'p1')])
    fireEvent.click(container.querySelector('.bulk-close__backdrop')!)
    expect(onClose).toHaveBeenCalledOnce()
  })

  it('does not dismiss when the dialog body is clicked', () => {
    const { container } = renderDialog([session('a', 'p1')])
    fireEvent.click(container.querySelector('.bulk-close')!)
    expect(onClose).not.toHaveBeenCalled()
  })
})
