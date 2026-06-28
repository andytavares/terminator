import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import React from 'react'
import { GatePanel } from '../../src/components/GatePanel.js'
import type { PhaseState } from '../../src/types/speckit.types.js'

function makePhaseState(overrides?: Partial<PhaseState>): PhaseState {
  return {
    id: 'specify',
    status: 'awaiting_review',
    approvedHash: null,
    approvedAt: null,
    approvedBy: null,
    lastRunId: null,
    lastRunAt: null,
    artifactPaths: [],
    feedback: null,
    batchIndex: null,
    ...overrides,
  }
}

describe('GatePanel', () => {
  const noop = vi.fn().mockResolvedValue(undefined)

  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('renders artifact content in preview area', () => {
    render(
      <GatePanel
        featureDir="/repo/specs/001"
        phase="specify"
        phaseState={makePhaseState()}
        artifactContent="# My Spec\n\nSome content here."
        onApprove={noop}
        onRequestChanges={noop}
      />
    )
    expect(screen.getByText(/My Spec/)).toBeTruthy()
  })

  it('shows placeholder when no artifact content', () => {
    render(
      <GatePanel
        featureDir="/repo/specs/001"
        phase="specify"
        phaseState={makePhaseState()}
        artifactContent={null}
        onApprove={noop}
        onRequestChanges={noop}
      />
    )
    expect(screen.getByText(/no artifact/i)).toBeTruthy()
  })

  it('shows Approve button', () => {
    render(
      <GatePanel
        featureDir="/repo/specs/001"
        phase="specify"
        phaseState={makePhaseState()}
        artifactContent="content"
        onApprove={noop}
        onRequestChanges={noop}
      />
    )
    expect(screen.getByRole('button', { name: /approve/i })).toBeTruthy()
  })

  it('calls onApprove when Approve is clicked', async () => {
    const onApprove = vi.fn().mockResolvedValue(undefined)
    render(
      <GatePanel
        featureDir="/repo/specs/001"
        phase="specify"
        phaseState={makePhaseState()}
        artifactContent="content"
        onApprove={onApprove}
        onRequestChanges={noop}
      />
    )
    fireEvent.click(screen.getByRole('button', { name: /approve/i }))
    await waitFor(() => expect(onApprove).toHaveBeenCalledOnce())
  })

  it('shows Request changes button', () => {
    render(
      <GatePanel
        featureDir="/repo/specs/001"
        phase="specify"
        phaseState={makePhaseState()}
        artifactContent="content"
        onApprove={noop}
        onRequestChanges={noop}
      />
    )
    expect(screen.getByRole('button', { name: /request changes/i })).toBeTruthy()
  })

  it('shows feedback textarea when Request changes is clicked', () => {
    render(
      <GatePanel
        featureDir="/repo/specs/001"
        phase="specify"
        phaseState={makePhaseState()}
        artifactContent="content"
        onApprove={noop}
        onRequestChanges={noop}
      />
    )
    fireEvent.click(screen.getByRole('button', { name: /request changes/i }))
    expect(screen.getByRole('textbox')).toBeTruthy()
  })

  it('calls onRequestChanges with feedback note on submit', async () => {
    const onRequestChanges = vi.fn().mockResolvedValue(undefined)
    render(
      <GatePanel
        featureDir="/repo/specs/001"
        phase="specify"
        phaseState={makePhaseState()}
        artifactContent="content"
        onApprove={noop}
        onRequestChanges={onRequestChanges}
      />
    )
    fireEvent.click(screen.getByRole('button', { name: /request changes/i }))
    const textarea = screen.getByRole('textbox')
    fireEvent.change(textarea, { target: { value: 'needs more detail' } })
    fireEvent.click(screen.getByRole('button', { name: /submit/i }))
    await waitFor(() => expect(onRequestChanges).toHaveBeenCalledWith('needs more detail'))
  })

  // T043 — gate actions: Revoke, Comment, inline edit
  it('shows Revoke button', () => {
    render(
      <GatePanel
        featureDir="/repo/specs/001"
        phase="specify"
        phaseState={makePhaseState()}
        artifactContent="content"
        onApprove={noop}
        onRequestChanges={noop}
        onRevoke={noop}
        onComment={noop}
      />
    )
    expect(screen.getByRole('button', { name: /revoke/i })).toBeTruthy()
  })

  it('calls onRevoke when Revoke is clicked', async () => {
    const onRevoke = vi.fn().mockResolvedValue(undefined)
    render(
      <GatePanel
        featureDir="/repo/specs/001"
        phase="specify"
        phaseState={makePhaseState()}
        artifactContent="content"
        onApprove={noop}
        onRequestChanges={noop}
        onRevoke={onRevoke}
        onComment={noop}
      />
    )
    fireEvent.click(screen.getByRole('button', { name: /revoke/i }))
    await waitFor(() => expect(onRevoke).toHaveBeenCalledOnce())
  })

  it('shows stale propagation banner with affected phases when stalePhases prop is provided', () => {
    render(
      <GatePanel
        featureDir="/repo/specs/001"
        phase="specify"
        phaseState={makePhaseState()}
        artifactContent="content"
        onApprove={noop}
        onRequestChanges={noop}
        onRevoke={noop}
        onComment={noop}
        stalePhases={['plan', 'checklist']}
      />
    )
    expect(screen.getByText(/plan/i)).toBeTruthy()
    expect(screen.getByText(/checklist/i)).toBeTruthy()
  })

  it('shows Comment button', () => {
    render(
      <GatePanel
        featureDir="/repo/specs/001"
        phase="specify"
        phaseState={makePhaseState()}
        artifactContent="content"
        onApprove={noop}
        onRequestChanges={noop}
        onRevoke={noop}
        onComment={noop}
      />
    )
    expect(screen.getByRole('button', { name: /comment/i })).toBeTruthy()
  })

  it('shows comment textarea when Comment button is clicked', () => {
    render(
      <GatePanel
        featureDir="/repo/specs/001"
        phase="specify"
        phaseState={makePhaseState()}
        artifactContent="content"
        onApprove={noop}
        onRequestChanges={noop}
        onRevoke={noop}
        onComment={noop}
      />
    )
    fireEvent.click(screen.getByRole('button', { name: /comment/i }))
    expect(screen.getByPlaceholderText(/leave a comment/i)).toBeTruthy()
  })

  it('calls onComment with note when comment is submitted', async () => {
    const onComment = vi.fn().mockResolvedValue(undefined)
    render(
      <GatePanel
        featureDir="/repo/specs/001"
        phase="specify"
        phaseState={makePhaseState()}
        artifactContent="content"
        onApprove={noop}
        onRequestChanges={noop}
        onRevoke={noop}
        onComment={onComment}
      />
    )
    fireEvent.click(screen.getByRole('button', { name: /comment/i }))
    const textarea = screen.getByPlaceholderText(/leave a comment/i)
    fireEvent.change(textarea, { target: { value: 'LGTM overall' } })
    fireEvent.click(screen.getByRole('button', { name: /post comment/i }))
    await waitFor(() => expect(onComment).toHaveBeenCalledWith('LGTM overall'))
  })

  it('shows Edit button', () => {
    render(
      <GatePanel
        featureDir="/repo/specs/001"
        phase="specify"
        phaseState={makePhaseState()}
        artifactContent="# Spec content"
        onApprove={noop}
        onRequestChanges={noop}
        onRevoke={noop}
        onComment={noop}
        onInlineEdit={noop}
      />
    )
    expect(screen.getByRole('button', { name: /edit/i })).toBeTruthy()
  })

  it('opens inline editor with artifact content when Edit is clicked', () => {
    render(
      <GatePanel
        featureDir="/repo/specs/001"
        phase="specify"
        phaseState={makePhaseState()}
        artifactContent="# My Spec"
        onApprove={noop}
        onRequestChanges={noop}
        onRevoke={noop}
        onComment={noop}
        onInlineEdit={noop}
      />
    )
    fireEvent.click(screen.getByRole('button', { name: /edit/i }))
    const editor = screen.getByRole('textbox', { name: /inline editor/i })
    expect((editor as HTMLTextAreaElement).value).toBe('# My Spec')
  })

  it('calls onInlineEdit with edited content when Save is clicked', async () => {
    const onInlineEdit = vi.fn().mockResolvedValue(undefined)
    render(
      <GatePanel
        featureDir="/repo/specs/001"
        phase="specify"
        phaseState={makePhaseState()}
        artifactContent="original content"
        onApprove={noop}
        onRequestChanges={noop}
        onRevoke={noop}
        onComment={noop}
        onInlineEdit={onInlineEdit}
      />
    )
    fireEvent.click(screen.getByRole('button', { name: /edit/i }))
    const editor = screen.getByRole('textbox', { name: /inline editor/i })
    fireEvent.change(editor, { target: { value: 'updated content' } })
    fireEvent.click(screen.getByRole('button', { name: /save/i }))
    await waitFor(() => expect(onInlineEdit).toHaveBeenCalledWith('updated content'))
  })
})
