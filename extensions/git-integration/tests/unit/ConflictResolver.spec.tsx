import { render, screen, waitFor, act } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import React from 'react'
import { EditorView } from '@codemirror/view'

const mockResolveConflict = vi.fn()
const mockPersistSession = vi.fn()
const mockUndoResolve = vi.fn()
const mockNotify = vi.fn()

vi.mock('../../src/api/merge-flow', () => ({
  mergeFlowAPI: {
    resolveConflict: (...a: unknown[]) => mockResolveConflict(...a),
    persistSession: (...a: unknown[]) => mockPersistSession(...a),
    undoResolve: (...a: unknown[]) => mockUndoResolve(...a),
  },
}))

vi.mock('../../src/api/notifications', () => ({
  notificationsAPI: { notify: (...a: unknown[]) => mockNotify(...a) },
}))

import { ConflictResolver } from '../../src/components/merge-flow/ConflictResolver'
import { useMergeFlowStore } from '../../src/stores/merge-flow.store'
import { ConflictPanel } from '../../src/components/merge-flow/ConflictPanel'
import { ResultPreviewStrip } from '../../src/components/merge-flow/ResultPreviewStrip'

function conflictBlock(index: number, overrides: Record<string, unknown> = {}) {
  return {
    blockId: `src/foo.ts#${index}`,
    index,
    oursText: `const x = ${index}`,
    theirsText: `const x = ${index + 100}`,
    baseText: '',
    contextBefore: ['// before'],
    contextAfter: ['// after'],
    originalConflictText: `<<<<<<< HEAD\nconst x = ${index}\n=======\nconst x = ${index + 100}\n>>>>>>> branch`,
    isResolved: false,
    ...overrides,
  }
}

const baseBlock = conflictBlock(0, { oursText: 'const x = 1', theirsText: 'const x = 2' })

function sessionWithBlocks(blockCount: number) {
  return {
    repoRoot: '/repo',
    isRebase: false,
    totalConflicts: blockCount,
    totalResolved: 0,
    startedAt: '',
    files: [
      {
        filePath: 'src/foo.ts',
        conflictCount: blockCount,
        resolvedCount: 0,
        conflictDescription: 'both sides edited x',
        oursAuthor: { name: 'Alice', commitHash: 'abc', timestamp: '' },
        theirsAuthor: { name: 'Bob', commitHash: 'def', timestamp: '' },
        blocks: Array.from({ length: blockCount }, (_, i) => conflictBlock(i)),
      },
    ],
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  mockResolveConflict.mockResolvedValue({ success: true })
  mockPersistSession.mockResolvedValue({ success: true })
  mockUndoResolve.mockResolvedValue({ success: true })
  useMergeFlowStore.getState().clearSession()
})

function renderResolver(blockCount: number) {
  useMergeFlowStore.getState().startSession(sessionWithBlocks(blockCount) as never)
  const handlers = { onBack: vi.fn(), onComplete: vi.fn() }
  const view = render(<ConflictResolver repoRoot="/repo" {...handlers} />)
  return { ...view, ...handlers }
}

function activeBlock() {
  const { session, activeFileIndex, activeBlockIndex } = useMergeFlowStore.getState()
  return session!.files[activeFileIndex].blocks[activeBlockIndex]
}

describe('ConflictResolver', () => {
  it('shows the file description, progress and both sides of the active block', () => {
    const { container } = renderResolver(2)
    expect(screen.getByText('both sides edited x')).toBeTruthy()
    expect(screen.getByText(/Conflict 1 of 2/)).toBeTruthy()
    expect(container.textContent).toContain('const x = 0')
    expect(container.textContent).toContain('const x = 100')
  })

  it('previews the chosen side, and sends nothing until confirmed', async () => {
    const user = userEvent.setup()
    renderResolver(2)
    expect(screen.queryByRole('button', { name: /Confirm/ })).toBeNull()
    await user.click(screen.getByRole('button', { name: /Keep theirs/ }))
    expect(screen.getByRole('group', { name: 'Preview' }).textContent).toContain('const x = 100')
    expect(mockResolveConflict).not.toHaveBeenCalled()
  })
})

describe('ConflictResolver — resolves with the chosen side and moves to the next conflict', () => {
  it('resolves with the chosen side and moves to the next conflict', async () => {
    const user = userEvent.setup()
    renderResolver(2)
    await user.click(screen.getByRole('button', { name: /Keep mine/ }))
    await user.click(screen.getByRole('button', { name: /Confirm/ }))
    await waitFor(() => expect(useMergeFlowStore.getState().activeBlockIndex).toBe(1))
    expect(mockResolveConflict).toHaveBeenCalledWith({
      repoRoot: '/repo',
      blockId: 'src/foo.ts#0',
      resolvedText: 'const x = 0',
      strategy: 'ours',
      originalConflictText: conflictBlock(0).originalConflictText,
    })
    expect(mockPersistSession).toHaveBeenCalledOnce()
    expect(useMergeFlowStore.getState().session!.files[0].blocks[0].isResolved).toBe(true)
  })

  it('calls onComplete when the last unresolved conflict is resolved', async () => {
    const user = userEvent.setup()
    const { onComplete } = renderResolver(1)
    await user.click(screen.getByRole('button', { name: /Keep theirs/ }))
    await user.click(screen.getByRole('button', { name: /Confirm/ }))
    await waitFor(() => expect(onComplete).toHaveBeenCalledOnce())
    expect(mockResolveConflict.mock.calls[0][0].resolvedText).toBe('const x = 100')
  })
})

describe('ConflictResolver — keeps the conflict unresolved and reports the error when resolving fails', () => {
  it('keeps the conflict unresolved and reports the error when resolving fails', async () => {
    const user = userEvent.setup()
    mockResolveConflict.mockResolvedValue({ error: 'git add failed' })
    const { onComplete } = renderResolver(1)
    await user.click(screen.getByRole('button', { name: /Keep mine/ }))
    await user.click(screen.getByRole('button', { name: /Confirm/ }))
    await waitFor(() => expect(mockNotify).toHaveBeenCalled())
    expect(mockNotify).toHaveBeenCalledWith({
      type: 'error',
      title: 'Could not resolve conflict',
      key: 'conflictResolveFailed',
      message: 'git add failed',
    })
    expect(activeBlock().isResolved).toBe(false)
    expect(onComplete).not.toHaveBeenCalled()
  })

  it('selects with M and T and confirms with Enter', async () => {
    const user = userEvent.setup()
    renderResolver(2)
    await user.keyboard('m')
    await user.keyboard('t')
    await user.keyboard('{Enter}')
    await waitFor(() => expect(mockResolveConflict).toHaveBeenCalledOnce())
    expect(mockResolveConflict.mock.calls[0][0]).toMatchObject({
      resolvedText: 'const x = 100',
      strategy: 'theirs',
    })
  })
})

describe('ConflictResolver — navigates between conflicts with the arrow keys', () => {
  it('navigates between conflicts with the arrow keys', async () => {
    const user = userEvent.setup()
    renderResolver(2)
    await user.keyboard('{ArrowRight}')
    expect(useMergeFlowStore.getState().activeBlockIndex).toBe(1)
    await user.keyboard('{ArrowLeft}')
    expect(useMergeFlowStore.getState().activeBlockIndex).toBe(0)
  })

  it('clears a pending choice when moving to another conflict', async () => {
    const user = userEvent.setup()
    renderResolver(2)
    await user.click(screen.getByRole('button', { name: /Keep mine/ }))
    expect(screen.getByRole('button', { name: /Confirm/ })).toBeTruthy()
    await user.keyboard('{ArrowRight}')
    expect(screen.queryByRole('button', { name: /Confirm/ })).toBeNull()
  })
})

describe('ConflictResolver — resolves with the edited text and strategy manual from the editor', () => {
  it('resolves with the edited text and strategy manual from the editor', async () => {
    const user = userEvent.setup()
    renderResolver(1)
    await user.click(screen.getByRole('button', { name: /Edit manually/ }))
    const view = EditorView.findFromDOM(screen.getByRole('textbox'))!
    act(() => {
      view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: 'const x = 42' } })
    })
    await user.click(screen.getByRole('button', { name: /Save/ }))
    await waitFor(() => expect(mockResolveConflict).toHaveBeenCalledOnce())
    expect(mockResolveConflict.mock.calls[0][0]).toMatchObject({
      resolvedText: 'const x = 42',
      strategy: 'manual',
    })
  })

  it('pushes the other side into the open editor on Keep theirs, without resolving', async () => {
    const user = userEvent.setup()
    renderResolver(1)
    await user.click(screen.getByRole('button', { name: /Edit manually/ }))
    await user.click(screen.getByRole('button', { name: /Keep theirs/ }))
    const view = EditorView.findFromDOM(screen.getByRole('textbox'))!
    expect(view.state.doc.toString()).toBe('const x = 100')
    expect(mockResolveConflict).not.toHaveBeenCalled()
  })
})

describe('ConflictResolver — undoes the last decision and tells the main process', () => {
  it('undoes the last decision and tells the main process', async () => {
    const user = userEvent.setup()
    renderResolver(2)
    await user.click(screen.getByRole('button', { name: /Keep mine/ }))
    await user.click(screen.getByRole('button', { name: /Confirm/ }))
    await waitFor(() => expect(useMergeFlowStore.getState().activeBlockIndex).toBe(1))
    await user.click(screen.getByRole('button', { name: 'Undo last decision' }))
    await waitFor(() => expect(mockUndoResolve).toHaveBeenCalledOnce())
    expect(mockUndoResolve).toHaveBeenCalledWith({
      repoRoot: '/repo',
      blockId: 'src/foo.ts#0',
      resolvedText: 'const x = 0',
      originalConflictText: conflictBlock(0).originalConflictText,
    })
    expect(useMergeFlowStore.getState().session!.files[0].blocks[0].isResolved).toBe(false)
    expect(useMergeFlowStore.getState().activeBlockIndex).toBe(0)
  })

  it('resolves through Keep both in the order chosen in the modal', async () => {
    const user = userEvent.setup()
    renderResolver(2)
    await user.click(screen.getByRole('button', { name: /Keep both/ }))
    await user.click(screen.getByRole('button', { name: 'Use this order' }))
    await waitFor(() => expect(mockResolveConflict).toHaveBeenCalledOnce())
    expect(mockResolveConflict.mock.calls[0][0].strategy).toBe('both-ours-first')
    expect(mockResolveConflict.mock.calls[0][0].resolvedText).toContain('const x = 0')
    expect(mockResolveConflict.mock.calls[0][0].resolvedText).toContain('const x = 100')
  })
})

describe('ConflictPanel — side labels', () => {
  it.each([
    { isRebase: false, labels: ['Your version', 'Incoming changes'] },
    { isRebase: true, labels: ['Theirs (branch)', 'Your version'] },
  ])('labels ours and theirs $labels when isRebase is $isRebase', ({ isRebase, labels }) => {
    render(
      <ConflictPanel
        block={baseBlock}
        isRebase={isRebase}
        pendingStrategy={null}
        onSelectMine={vi.fn()}
        onSelectTheirs={vi.fn()}
      />
    )
    const sideLabels = screen.getAllByText(/^(Your version|Theirs \(branch\)|Incoming changes)$/)
    expect(sideLabels.map((label) => label.textContent)).toEqual(labels)
  })
})

describe('ConflictPanel — marks ours side selected when pendingStrategy is ours', () => {
  it('marks ours side selected when pendingStrategy is ours', () => {
    render(
      <ConflictPanel
        block={baseBlock}
        isRebase={false}
        pendingStrategy="ours"
        onSelectMine={vi.fn()}
        onSelectTheirs={vi.fn()}
      />
    )
    const pressed = (label: RegExp) =>
      screen.getByRole('button', { name: label }).getAttribute('aria-pressed')
    expect(pressed(/^Your version/)).toBe('true')
    expect(pressed(/^Incoming changes/)).toBe('false')
  })
})

describe('ConflictPanel — calls onSelectMine when ours side clicked', () => {
  it('calls onSelectMine when ours side clicked', async () => {
    const user = userEvent.setup()
    const onSelectMine = vi.fn()
    render(
      <ConflictPanel
        block={baseBlock}
        isRebase={false}
        pendingStrategy={null}
        onSelectMine={onSelectMine}
        onSelectTheirs={vi.fn()}
      />
    )
    await user.click(screen.getByText('Your version'))
    expect(onSelectMine).toHaveBeenCalledOnce()
  })
})

describe('ResultPreviewStrip', () => {
  it('shows placeholder when no resolution selected', () => {
    render(<ResultPreviewStrip resolvedText={null} />)
    expect(screen.getByText(/Select a resolution/i)).toBeTruthy()
  })
})
