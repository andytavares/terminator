import React from 'react'
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { WorktreeReclaim } from '../../../../src/renderer/components/supervision/WorktreeReclaim.js'

// A working copy that outlived its session costs a port span and however large
// the repository's dependencies are, and is visible from nowhere else.

const orphan = {
  path: '/Users/you/.terminator/wt/FLU-220-fluent',
  reason: 'orphan' as const,
  sessionId: null,
  branch: null,
  repoPath: null,
}
const finished = {
  path: '/Users/you/.terminator/wt/FLU-231-forge',
  reason: 'finished' as const,
  sessionId: 'a5',
  branch: 'feat/retry',
  repoPath: '/Users/you/repos/forge',
}

const panel = (over: Record<string, unknown> = {}) =>
  render(
    <WorktreeReclaim
      worktrees={[orphan, finished]}
      busyPath={null}
      lastError={null}
      onReclaim={() => {}}
      onReclaimAll={() => {}}
      onRefresh={() => {}}
      {...over}
    />
  )

describe('WorktreeReclaim', () => {
  it('says why each one can go', () => {
    panel()
    expect(screen.getByText(/no session references it/)).toBeDefined()
    expect(screen.getByText(/its session has finished/)).toBeDefined()
  })

  it('shows the full path, since the folder name alone is ambiguous', () => {
    panel()
    expect(screen.getByText('/Users/you/.terminator/wt/FLU-220-fluent')).toBeDefined()
  })

  it('names the branch when there is a session to name it from', () => {
    panel()
    expect(screen.getByText(/feat\/retry/)).toBeDefined()
  })

  it('reclaims the one that was clicked', () => {
    const onReclaim = vi.fn()
    panel({ onReclaim })
    fireEvent.click(screen.getAllByText('Reclaim')[0])
    expect(onReclaim).toHaveBeenCalledWith(orphan.path)
  })

  it('reclaims all of them, saying how many', () => {
    const onReclaimAll = vi.fn()
    panel({ onReclaimAll })
    fireEvent.click(screen.getByText(/Reclaim all 2/))
    expect(onReclaimAll).toHaveBeenCalled()
  })

  it('says which one it is working on and will not double-submit it', () => {
    const onReclaim = vi.fn()
    panel({ onReclaim, busyPath: orphan.path })
    expect(screen.getByText('Reclaiming…')).toBeDefined()
    fireEvent.click(screen.getByText('Reclaiming…'))
    expect(onReclaim).not.toHaveBeenCalled()
  })

  it('asserts there is nothing to do rather than rendering an empty box', () => {
    panel({ worktrees: [] })
    expect(screen.getByText(/Nothing to reclaim/)).toBeDefined()
  })

  it('offers no reclaim-all when there is nothing to reclaim', () => {
    panel({ worktrees: [] })
    expect(screen.queryByText(/Reclaim all/)).toBeNull()
  })

  it('states a refusal rather than letting it look like a silent success', () => {
    panel({ lastError: 'teardown exited 1: pnpm db:drop failed' })
    expect(screen.getByText(/pnpm db:drop failed/)).toBeDefined()
  })

  it('re-checks on request', () => {
    const onRefresh = vi.fn()
    panel({ onRefresh })
    fireEvent.click(screen.getByText('Refresh'))
    expect(onRefresh).toHaveBeenCalled()
  })

  it('explains what reclaiming does before you do it', () => {
    panel()
    expect(screen.getByText(/runs the repository.s teardown script/)).toBeDefined()
  })
})
