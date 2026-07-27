import React from 'react'
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import {
  AssignPanel,
  IntakePanel,
} from '../../../../src/renderer/components/supervision/AssignControls.js'

// The front door. Everything else in the console supervises what this creates.

describe('AssignPanel', () => {
  const panel = (over: Record<string, unknown> = {}) =>
    render(
      <AssignPanel
        autonomy="edit"
        workItemId={null}
        laneOrd={null}
        onAssign={() => {}}
        lastResult={null}
        busy={false}
        {...over}
      />
    )

  function fill(): void {
    fireEvent.change(screen.getByLabelText('Repository path'), {
      target: { value: '/repos/fluent' },
    })
    fireEvent.change(screen.getByLabelText('Branch'), { target: { value: 'feat/x' } })
  }

  it('will not start without a repository and a branch', () => {
    panel()
    expect(screen.getByText('Start').closest('button')?.hasAttribute('disabled')).toBe(true)
  })

  it('starts once both are given', () => {
    const onAssign = vi.fn()
    panel({ onAssign })
    fill()
    fireEvent.click(screen.getByText('Start'))
    expect(onAssign).toHaveBeenCalledWith({
      repoPath: '/repos/fluent',
      branch: 'feat/x',
      instruction: undefined,
      workItemId: undefined,
      laneOrd: undefined,
    })
  })

  it('carries an ad-hoc instruction, which is the whole task when there is no work item', () => {
    const onAssign = vi.fn()
    panel({ onAssign })
    fill()
    fireEvent.change(screen.getByLabelText('Instruction'), {
      target: { value: 'fix the flaky test' },
    })
    fireEvent.click(screen.getByText('Start'))
    expect(onAssign).toHaveBeenCalledWith(
      expect.objectContaining({ instruction: 'fix the flaky test' })
    )
  })

  it('starts on Enter from the instruction box', () => {
    const onAssign = vi.fn()
    panel({ onAssign })
    fill()
    fireEvent.keyDown(screen.getByLabelText('Instruction'), { key: 'Enter' })
    expect(onAssign).toHaveBeenCalled()
  })

  it('ignores other keys', () => {
    const onAssign = vi.fn()
    panel({ onAssign })
    fill()
    fireEvent.keyDown(screen.getByLabelText('Instruction'), { key: 'a' })
    expect(onAssign).not.toHaveBeenCalled()
  })

  it('binds to the selected work item and lane', () => {
    const onAssign = vi.fn()
    panel({ onAssign, workItemId: 'FLU-220', laneOrd: 2 })
    fill()
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
    fill()
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
