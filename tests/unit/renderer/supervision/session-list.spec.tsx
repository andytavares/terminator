import React from 'react'
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { SessionList } from '../../../../src/renderer/components/supervision/SessionList.js'
import type { SupervisedSession } from '../../../../src/shared/types/supervision.js'

// The attention queue answers "what needs me". Nothing answered "what is
// running", and a count in the status bar is not a list.

const NOW = 1_000_000

function session(over: Partial<SupervisedSession> = {}): SupervisedSession {
  return {
    id: 's1',
    workItemId: null,
    laneOrd: null,
    repoPath: '/Users/you/repos/fluent',
    worktreePath: '/wt/s1',
    branch: 'feat/session-ulid',
    transcriptPath: null,
    runtimeState: 'working',
    stateSince: NOW - 240_000,
    lastToolActivityAt: null,
    lastNetChangeAt: null,
    openShellCallId: null,
    turns: 74,
    costUsd: 6.8,
    contextPct: 61,
    pendingPermission: null,
    diffSummary: { files: 5, added: 142, removed: 96 },
    autonomyLevel: 'edit',
    lastViewedAt: null,
    runtimeSessionId: null,
    failure: null,
    ...over,
  }
}

const list = (sessions: SupervisedSession[], handlers: Record<string, unknown> = {}) =>
  render(
    <SessionList
      sessions={sessions}
      now={NOW}
      onStop={() => {}}
      onDiscard={() => {}}
      onOpen={() => {}}
      {...handlers}
    />
  )

describe('SessionList', () => {
  it('counts what is running, which is the thing you glance at', () => {
    list([session(), session({ id: 's2', runtimeState: 'merged' })])
    expect(screen.getByText('1 running')).toBeDefined()
  })

  it('shows what an agent has spent', () => {
    list([session()])
    expect(screen.getByText(/74 turns · \$6\.80 · 61% context/)).toBeDefined()
  })

  it('shows what it has changed', () => {
    list([session()])
    expect(screen.getByText(/5 files \+142 −96/)).toBeDefined()
  })

  it('says nothing about a diff that does not exist yet', () => {
    list([session({ diffSummary: { files: 0, added: 0, removed: 0 } })])
    expect(screen.queryByText(/files \+/)).toBeNull()
  })

  it('asks why before stopping, then stops', () => {
    const onStop = vi.fn()
    list([session()], { onStop })
    fireEvent.click(screen.getByText('Stop'))
    fireEvent.change(screen.getByLabelText('Why are you stopping it?'), {
      target: { value: 'wrong branch' },
    })
    fireEvent.click(screen.getByText('Stop'))
    expect(onStop).toHaveBeenCalledWith('s1', 'wrong branch')
  })

  it('stops without a reason when you do not give one', () => {
    const onStop = vi.fn()
    list([session()], { onStop })
    fireEvent.click(screen.getByText('Stop'))
    fireEvent.click(screen.getByText('Stop'))
    expect(onStop).toHaveBeenCalledWith('s1', undefined)
  })

  it('stops on Enter', () => {
    const onStop = vi.fn()
    list([session()], { onStop })
    fireEvent.click(screen.getByText('Stop'))
    const box = screen.getByLabelText('Why are you stopping it?')
    fireEvent.change(box, { target: { value: 'took the wrong approach' } })
    fireEvent.keyDown(box, { key: 'Enter' })
    expect(onStop).toHaveBeenCalledWith('s1', 'took the wrong approach')
  })

  it('backs out on Escape without stopping anything', () => {
    const onStop = vi.fn()
    list([session()], { onStop })
    fireEvent.click(screen.getByText('Stop'))
    fireEvent.keyDown(screen.getByLabelText('Why are you stopping it?'), { key: 'Escape' })
    expect(onStop).not.toHaveBeenCalled()
    expect(screen.queryByLabelText('Why are you stopping it?')).toBeNull()
  })

  it('offers no stop for a session that has already finished', () => {
    list([session({ runtimeState: 'merged' })])
    expect(screen.queryByText('Stop')).toBeNull()
  })

  it('offers a stop for one waiting on the operator — it is still holding a worktree', () => {
    list([session({ runtimeState: 'needs_input' })])
    expect(screen.getByText('Stop')).toBeDefined()
  })

  it('discards a session', () => {
    const onDiscard = vi.fn()
    list([session()], { onDiscard })
    fireEvent.click(screen.getByText('Discard'))
    expect(onDiscard).toHaveBeenCalledWith('s1')
  })

  it('shows the session’s detail in place, since nothing else shows one session', () => {
    list([session()])
    fireEvent.click(screen.getByText('Details'))
    const detail = document.querySelector('.sv-session__detail')?.textContent ?? ''
    expect(detail).toContain('/wt/s1')
    expect(detail).toContain('autonomy:    edit')
  })

  it('tells the shell which session was opened', () => {
    const onOpen = vi.fn()
    list([session()], { onOpen })
    fireEvent.click(screen.getByText('Details'))
    expect(onOpen).toHaveBeenCalledWith('s1')
  })

  it('collapses again', () => {
    list([session()])
    fireEvent.click(screen.getByText('Details'))
    fireEvent.click(screen.getByText('Details'))
    expect(document.querySelector('.sv-session__detail')).toBeNull()
  })

  it('says why a failed session failed', () => {
    list([
      session({
        runtimeState: 'failed',
        failure: { step: 'setup', exitCode: 3, output: 'lockfile is out of date' },
      }),
    ])
    fireEvent.click(screen.getByText('Details'))
    const detail = document.querySelector('.sv-session__detail')?.textContent ?? ''
    expect(detail).toContain('setup exited 3')
    expect(detail).toContain('lockfile is out of date')
  })

  it('says a working copy was never provisioned rather than showing an empty path', () => {
    list([session({ worktreePath: '' })])
    fireEvent.click(screen.getByText('Details'))
    expect(document.querySelector('.sv-session__detail')?.textContent).toContain('not provisioned')
  })

  it('names the work item and lane a session is bound to', () => {
    list([session({ workItemId: 'FLU-220', laneOrd: 2 })])
    fireEvent.click(screen.getByText('Details'))
    expect(document.querySelector('.sv-session__detail')?.textContent).toContain('FLU-220 · lane 2')
  })

  it('puts what is running above what is finished', () => {
    list([session({ id: 'done', runtimeState: 'merged', branch: 'chore/done' }), session()])
    const titles = [...document.querySelectorAll('.sv-queue__title')].map((n) => n.textContent)
    expect(titles).toEqual(['feat/session-ulid', 'chore/done'])
  })

  it('says what a blocked session is waiting for', () => {
    list([
      session({
        runtimeState: 'needs_input',
        pendingPermission: {
          requestId: 'r1',
          toolName: 'Bash',
          summary: 'rm -rf build',
          requestedAt: NOW,
        },
      }),
    ])
    expect(screen.getByText(/Waiting on you: rm -rf build/)).toBeDefined()
  })

  it('says there is nothing rather than rendering an empty box', () => {
    list([])
    expect(screen.getByText(/No sessions/)).toBeDefined()
  })

  it('explains what stopping costs you, and what discarding costs you', () => {
    list([session()])
    expect(screen.getByText(/keeps the working copy/)).toBeDefined()
  })
})

describe('what a row says when the numbers are missing', () => {
  it('says one turn in the singular', () => {
    list([session({ turns: 1 })])
    expect(screen.getByText(/1 turn ·/)).toBeDefined()
  })

  it('leaves out a cost of nothing rather than printing $0.00', () => {
    list([session({ costUsd: 0 })])
    expect(screen.queryByText(/\$0\.00/)).toBeNull()
  })

  it('leaves out a context proportion it does not know', () => {
    // Unknown is not zero, and the row must not imply it is.
    list([session({ contextPct: null })])
    expect(screen.queryByText(/% context/)).toBeNull()
  })

  it('says one file in the singular', () => {
    list([session({ diffSummary: { files: 1, added: 2, removed: 0 } })])
    expect(screen.getByText(/1 file \+2 −0/)).toBeDefined()
  })

  it('says one session in the singular', () => {
    list([session()])
    expect(screen.getByText('1 session')).toBeDefined()
  })
})

describe('checking in on a session', () => {
  it('offers a terminal in the working copy', () => {
    const onAttach = vi.fn()
    list([session()], { onAttach })
    fireEvent.click(screen.getByText('Terminal'))
    expect(onAttach).toHaveBeenCalledWith(expect.objectContaining({ id: 's1' }))
  })

  it('offers none for a session that never got a working copy', () => {
    list([session({ worktreePath: '' })])
    expect(screen.queryByText('Terminal')).toBeNull()
  })

  it('shows the agent’s own session id, which is what resumes it by hand', () => {
    list([session({ runtimeSessionId: 'b1e2c3d4' })])
    fireEvent.click(screen.getByText('Details'))
    expect(document.querySelector('.sv-session__detail')?.textContent).toContain('b1e2c3d4')
  })
})
