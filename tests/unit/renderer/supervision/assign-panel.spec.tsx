import React from 'react'
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import {
  AssignPanel,
  IntakePanel,
} from '../../../../src/renderer/components/supervision/AssignControls.js'

// The front door. Everything else in the console supervises what this creates.

describe('AssignPanel', () => {
  const REPOS = [
    { path: '/Users/you/repos/fluent', label: 'fluent' },
    { path: '/Users/you/repos/forge', label: 'forge' },
  ]

  const panel = (over: Record<string, unknown> = {}) =>
    render(
      <AssignPanel
        autonomy="edit"
        workItemId={null}
        laneOrd={null}
        repos={REPOS}
        branches={['main', 'feat/existing']}
        currentBranch="main"
        onRepoChange={() => {}}
        onAssign={() => {}}
        lastResult={null}
        busy={false}
        {...over}
      />
    )

  const nameBranch = (name: string): void => {
    fireEvent.change(screen.getByLabelText('New branch name'), { target: { value: name } })
  }

  it('offers the repositories the app already knows, not a path to retype', () => {
    panel()
    const select = screen.getByLabelText('Repository') as HTMLSelectElement
    expect([...select.options].map((option) => option.value)).toEqual([
      '/Users/you/repos/fluent',
      '/Users/you/repos/forge',
    ])
  })

  it('selects the first repository without being asked', () => {
    panel()
    expect((screen.getByLabelText('Repository') as HTMLSelectElement).value).toBe(
      '/Users/you/repos/fluent'
    )
  })

  it('shows the path of what is selected, without burying it in the option', () => {
    panel()
    expect(screen.getByText('/Users/you/repos/fluent')).toBeDefined()
  })

  it('says so when there are no repositories yet, rather than an empty picker', () => {
    panel({ repos: [] })
    expect(screen.getByText(/Add a workspace in the sidebar/)).toBeDefined()
  })

  it('reports the chosen repository so its branches can be read', () => {
    const onRepoChange = vi.fn()
    panel({ onRepoChange })
    fireEvent.change(screen.getByLabelText('Repository'), {
      target: { value: '/Users/you/repos/forge' },
    })
    expect(onRepoChange).toHaveBeenCalledWith('/Users/you/repos/forge')
  })

  it('will not start without a branch', () => {
    panel()
    expect(screen.getByText('Start').closest('button')?.hasAttribute('disabled')).toBe(true)
  })

  it('starts on a new branch, which is the default', () => {
    const onAssign = vi.fn()
    panel({ onAssign })
    nameBranch('feat/session-ulid')
    fireEvent.click(screen.getByText('Start'))
    expect(onAssign).toHaveBeenCalledWith({
      repoPath: '/Users/you/repos/fluent',
      branch: 'feat/session-ulid',
      instruction: undefined,
      workItemId: undefined,
      laneOrd: undefined,
    })
  })

  it('names what a new branch is cut from', () => {
    panel()
    expect(screen.getByText(/Branched from main/)).toBeDefined()
  })

  it('offers the repository’s own branches when working on an existing one', () => {
    panel()
    fireEvent.click(screen.getByText('Existing'))
    const select = screen.getByLabelText('Existing branch') as HTMLSelectElement
    expect([...select.options].map((option) => option.value)).toEqual(['', 'main', 'feat/existing'])
  })

  it('starts on a chosen existing branch', () => {
    const onAssign = vi.fn()
    panel({ onAssign })
    fireEvent.click(screen.getByText('Existing'))
    fireEvent.change(screen.getByLabelText('Existing branch'), {
      target: { value: 'feat/existing' },
    })
    fireEvent.click(screen.getByText('Start'))
    expect(onAssign).toHaveBeenCalledWith(expect.objectContaining({ branch: 'feat/existing' }))
  })

  it('will not start on the empty placeholder option', () => {
    panel()
    fireEvent.click(screen.getByText('Existing'))
    expect(screen.getByText('Start').closest('button')?.hasAttribute('disabled')).toBe(true)
  })

  it('clears the branch when the repository changes, so it cannot be stale', () => {
    panel()
    nameBranch('feat/session-ulid')
    fireEvent.change(screen.getByLabelText('Repository'), {
      target: { value: '/Users/you/repos/forge' },
    })
    expect((screen.getByLabelText('New branch name') as HTMLInputElement).value).toBe('')
  })

  it('carries an ad-hoc instruction, which is the whole task when there is no work item', () => {
    const onAssign = vi.fn()
    panel({ onAssign })
    nameBranch('feat/x')
    fireEvent.change(screen.getByLabelText('Instruction'), {
      target: { value: 'fix the flaky test' },
    })
    fireEvent.click(screen.getByText('Start'))
    expect(onAssign).toHaveBeenCalledWith(
      expect.objectContaining({ instruction: 'fix the flaky test' })
    )
  })

  it('starts on Enter from the branch name', () => {
    const onAssign = vi.fn()
    panel({ onAssign })
    nameBranch('feat/x')
    fireEvent.keyDown(screen.getByLabelText('New branch name'), { key: 'Enter' })
    expect(onAssign).toHaveBeenCalled()
  })

  it('ignores other keys', () => {
    const onAssign = vi.fn()
    panel({ onAssign })
    nameBranch('feat/x')
    fireEvent.keyDown(screen.getByLabelText('New branch name'), { key: 'a' })
    expect(onAssign).not.toHaveBeenCalled()
  })

  it('binds to the selected work item and lane', () => {
    const onAssign = vi.fn()
    panel({ onAssign, workItemId: 'FLU-220', laneOrd: 2 })
    nameBranch('feat/x')
    fireEvent.click(screen.getByText('Start'))
    expect(onAssign).toHaveBeenCalledWith(
      expect.objectContaining({ workItemId: 'FLU-220', laneOrd: 2 })
    )
  })

  it('says what it is bound to', () => {
    panel({ workItemId: 'FLU-220', laneOrd: 2 })
    expect(screen.getByText(/Bound to FLU-220 · lane 2/)).toBeDefined()
  })

  it('asks for a steer rather than a task when bound to a work item', () => {
    panel({ workItemId: 'FLU-220', laneOrd: null })
    expect(screen.getByText('Anything to add?')).toBeDefined()
  })

  it('shows the autonomy it will start with (FR-041)', () => {
    panel({ autonomy: 'ship' })
    expect(screen.getByText(/autonomy: ship/)).toBeDefined()
  })

  it('will not start twice while one attempt is in flight', () => {
    const onAssign = vi.fn()
    panel({ onAssign, busy: true })
    nameBranch('feat/x')
    fireEvent.click(screen.getByText('Starting…'))
    expect(onAssign).not.toHaveBeenCalled()
  })

  it('reports where the session started', () => {
    panel({ lastResult: { ok: true, worktreePath: '/wt/FLU-220-fluent' } })
    expect(screen.getByText(/Started in \/wt\/FLU-220-fluent/)).toBeDefined()
  })

  it('states a refusal rather than failing silently (FR-034, FR-083)', () => {
    panel({ lastResult: { ok: false, reason: 'spec_approved_by_human is not approved' } })
    expect(screen.getByText(/spec_approved_by_human is not approved/)).toBeDefined()
  })

  it('falls back to a stated reason when none was given', () => {
    panel({ lastResult: { ok: false } })
    expect(screen.getByText(/could not start/)).toBeDefined()
  })

  it('offers no branch list it cannot fill', () => {
    panel({ branches: [], currentBranch: null })
    fireEvent.click(screen.getByText('Existing'))
    const select = screen.getByLabelText('Existing branch') as HTMLSelectElement
    expect(select.options).toHaveLength(1)
  })
})

describe('IntakePanel (FR-068)', () => {
  const panel = (over: Record<string, unknown> = {}) =>
    render(<IntakePanel onIntake={() => {}} result={null} {...over} />)

  it('treats an absolute path as a local document', () => {
    const onIntake = vi.fn()
    panel({ onIntake })
    fireEvent.change(screen.getByLabelText('Ticket URL or local document path'), {
      target: { value: '/specs/idea.md' },
    })
    fireEvent.click(screen.getByText('Queue it'))
    expect(onIntake).toHaveBeenCalledWith({ filePath: '/specs/idea.md' })
  })

  it('treats anything else as a ticket url', () => {
    const onIntake = vi.fn()
    panel({ onIntake })
    fireEvent.change(screen.getByLabelText('Ticket URL or local document path'), {
      target: { value: 'https://linear.app/x' },
    })
    fireEvent.keyDown(screen.getByLabelText('Ticket URL or local document path'), { key: 'Enter' })
    expect(onIntake).toHaveBeenCalledWith({ url: 'https://linear.app/x' })
  })

  it('refuses an empty submission', () => {
    const onIntake = vi.fn()
    panel({ onIntake })
    fireEvent.click(screen.getByText('Queue it'))
    expect(onIntake).not.toHaveBeenCalled()
  })

  it('says a queued item waits rather than starting on its own', () => {
    // Auto-start on intake is what produces backlogs nobody can review.
    panel({ result: { ok: true, id: 'FLU-221' } })
    expect(screen.getByText(/Queued as FLU-221\. It waits until you start it\./)).toBeDefined()
  })

  it('reports a refusal', () => {
    panel({ result: { ok: false, reason: 'not a recognised URL' } })
    expect(screen.getByText(/not a recognised URL/)).toBeDefined()
  })

  it('falls back to a stated reason when none was given', () => {
    panel({ result: { ok: false } })
    expect(screen.getByText(/could not bring that in/)).toBeDefined()
  })

  it('clears the box after a submission', () => {
    panel({ onIntake: vi.fn() })
    const input = screen.getByLabelText('Ticket URL or local document path') as HTMLInputElement
    fireEvent.change(input, { target: { value: 'https://linear.app/x' } })
    fireEvent.click(screen.getByText('Queue it'))
    expect(input.value).toBe('')
  })
})
