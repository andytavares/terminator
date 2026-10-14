import { render, screen, fireEvent, waitFor, act } from '@testing-library/react'
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
import { ActionBar } from '../../src/components/merge-flow/ActionBar'
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
  it('renders nothing when there is no session', () => {
    const { container } = render(
      <ConflictResolver repoRoot="/repo" onBack={vi.fn()} onComplete={vi.fn()} />
    )
    expect(container.firstChild).toBeNull()
  })

  it('shows the file description, progress and both sides of the active block', () => {
    const { container } = renderResolver(2)
    expect(screen.getByText('both sides edited x')).toBeTruthy()
    expect(screen.getByText(/Conflict 1 of 2/)).toBeTruthy()
    expect(container.textContent).toContain('const x = 0')
    expect(container.textContent).toContain('const x = 100')
  })

  it('previews the chosen side, and sends nothing until confirmed', () => {
    renderResolver(2)
    expect(screen.queryByText(/Confirm/)).toBeNull()
    fireEvent.click(screen.getByText(/Keep theirs/))
    expect(screen.getByText('Preview').parentElement!.textContent).toContain('const x = 100')
    expect(mockResolveConflict).not.toHaveBeenCalled()
  })
})

describe('ConflictResolver — resolves with the chosen side and moves to the next conflict', () => {
  it('resolves with the chosen side and moves to the next conflict', async () => {
    renderResolver(2)
    fireEvent.click(screen.getByText(/Keep mine/))
    fireEvent.click(screen.getByText(/Confirm/))
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
    const { onComplete } = renderResolver(1)
    fireEvent.click(screen.getByText(/Keep theirs/))
    fireEvent.click(screen.getByText(/Confirm/))
    await waitFor(() => expect(onComplete).toHaveBeenCalledOnce())
    expect(mockResolveConflict.mock.calls[0][0].resolvedText).toBe('const x = 100')
  })
})

describe('ConflictResolver — keeps the conflict unresolved and reports the error when resolving fails', () => {
  it('keeps the conflict unresolved and reports the error when resolving fails', async () => {
    mockResolveConflict.mockResolvedValue({ error: 'git add failed' })
    const { onComplete } = renderResolver(1)
    fireEvent.click(screen.getByText(/Keep mine/))
    fireEvent.click(screen.getByText(/Confirm/))
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
    renderResolver(2)
    fireEvent.keyDown(window, { key: 'm' })
    fireEvent.keyDown(window, { key: 't' })
    fireEvent.keyDown(window, { key: 'Enter' })
    await waitFor(() => expect(mockResolveConflict).toHaveBeenCalledOnce())
    expect(mockResolveConflict.mock.calls[0][0]).toMatchObject({
      resolvedText: 'const x = 100',
      strategy: 'theirs',
    })
  })
})

describe('ConflictResolver — navigates between conflicts with the arrow keys', () => {
  it('navigates between conflicts with the arrow keys', () => {
    renderResolver(2)
    fireEvent.keyDown(window, { key: 'ArrowRight' })
    expect(useMergeFlowStore.getState().activeBlockIndex).toBe(1)
    fireEvent.keyDown(window, { key: 'ArrowLeft' })
    expect(useMergeFlowStore.getState().activeBlockIndex).toBe(0)
  })

  it('clears a pending choice when moving to another conflict', () => {
    renderResolver(2)
    fireEvent.click(screen.getByText(/Keep mine/))
    expect(screen.getByText(/Confirm/)).toBeTruthy()
    fireEvent.keyDown(window, { key: 'ArrowRight' })
    expect(screen.queryByText(/Confirm/)).toBeNull()
  })
})

describe('ConflictResolver — resolves with the edited text and strategy manual from the editor', () => {
  it('resolves with the edited text and strategy manual from the editor', async () => {
    const { container } = renderResolver(1)
    fireEvent.click(screen.getByText(/Edit manually/))
    const content = container.querySelector('.cm-content') as HTMLElement
    const view = EditorView.findFromDOM(content.parentElement!.parentElement as HTMLElement)!
    act(() => {
      view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: 'const x = 42' } })
    })
    fireEvent.click(screen.getByRole('button', { name: /Save/ }))
    await waitFor(() => expect(mockResolveConflict).toHaveBeenCalledOnce())
    expect(mockResolveConflict.mock.calls[0][0]).toMatchObject({
      resolvedText: 'const x = 42',
      strategy: 'manual',
    })
  })

  it('pushes the other side into the open editor on Keep theirs, without resolving', () => {
    const { container } = renderResolver(1)
    fireEvent.click(screen.getByText(/Edit manually/))
    fireEvent.click(screen.getByText(/Keep theirs/))
    const content = container.querySelector('.cm-content') as HTMLElement
    const view = EditorView.findFromDOM(content.parentElement!.parentElement as HTMLElement)!
    expect(view.state.doc.toString()).toBe('const x = 100')
    expect(mockResolveConflict).not.toHaveBeenCalled()
  })
})

describe('ConflictResolver — undoes the last decision and tells the main process', () => {
  it('undoes the last decision and tells the main process', async () => {
    renderResolver(2)
    fireEvent.click(screen.getByText(/Keep mine/))
    fireEvent.click(screen.getByText(/Confirm/))
    await waitFor(() => expect(useMergeFlowStore.getState().activeBlockIndex).toBe(1))
    fireEvent.click(screen.getByText(/Undo/))
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
    renderResolver(2)
    fireEvent.click(screen.getByText(/Keep both/))
    fireEvent.click(screen.getByText(/Use this order/))
    await waitFor(() => expect(mockResolveConflict).toHaveBeenCalledOnce())
    expect(mockResolveConflict.mock.calls[0][0].strategy).toBe('both-ours-first')
    expect(mockResolveConflict.mock.calls[0][0].resolvedText).toContain('const x = 0')
    expect(mockResolveConflict.mock.calls[0][0].resolvedText).toContain('const x = 100')
  })
})

describe('ConflictPanel', () => {
  it('renders ours and theirs code', () => {
    const { container } = render(
      <ConflictPanel
        block={baseBlock}
        isRebase={false}
        pendingStrategy={null}
        onSelectMine={vi.fn()}
        onSelectTheirs={vi.fn()}
      />
    )
    // Text may be split across highlight.js spans — check textContent
    expect(container.textContent).toContain('const x = 1')
    expect(container.textContent).toContain('const x = 2')
  })
})

describe('ConflictPanel — shows Your version and Incoming changes labels for non-rebase', () => {
  it('shows Your version and Incoming changes labels for non-rebase', () => {
    render(
      <ConflictPanel
        block={baseBlock}
        isRebase={false}
        pendingStrategy={null}
        onSelectMine={vi.fn()}
        onSelectTheirs={vi.fn()}
      />
    )
    expect(screen.getByText('Your version')).toBeTruthy()
    expect(screen.getByText('Incoming changes')).toBeTruthy()
  })
})

describe('ConflictPanel — inverts labels for rebase', () => {
  it('inverts labels for rebase', () => {
    render(
      <ConflictPanel
        block={baseBlock}
        isRebase={true}
        pendingStrategy={null}
        onSelectMine={vi.fn()}
        onSelectTheirs={vi.fn()}
      />
    )
    expect(screen.getByText('Theirs (branch)')).toBeTruthy()
    // rebase theirs label shows "Your version"
    expect(screen.getAllByText('Your version').length).toBeGreaterThan(0)
  })
})

describe('ConflictPanel — marks ours side selected when pendingStrategy is ours', () => {
  it('marks ours side selected when pendingStrategy is ours', () => {
    const { container } = render(
      <ConflictPanel
        block={baseBlock}
        isRebase={false}
        pendingStrategy="ours"
        onSelectMine={vi.fn()}
        onSelectTheirs={vi.fn()}
      />
    )
    const selected = container.querySelector('.conflict-panel__side--selected')
    expect(selected).toBeTruthy()
  })
})

describe('ConflictPanel — calls onSelectMine when ours side clicked', () => {
  it('calls onSelectMine when ours side clicked', () => {
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
    fireEvent.click(screen.getByText('Your version'))
    expect(onSelectMine).toHaveBeenCalledOnce()
  })
})

describe('ResultPreviewStrip', () => {
  it('shows placeholder when no resolution selected', () => {
    render(<ResultPreviewStrip resolvedText={null} />)
    expect(screen.getByText(/Select a resolution/i)).toBeTruthy()
  })

  it('shows resolved text when available', () => {
    const { container } = render(<ResultPreviewStrip resolvedText="const x = 1" />)
    // Text may be split across highlight.js spans — check textContent
    expect(container.textContent).toContain('const x = 1')
  })
})

describe('ActionBar', () => {
  it('renders all action buttons', () => {
    render(
      <ActionBar
        pendingResolution={null}
        onKeepMine={vi.fn()}
        onKeepTheirs={vi.fn()}
        onKeepBoth={vi.fn()}
        onEdit={vi.fn()}
        onConfirm={vi.fn()}
      />
    )
    expect(screen.getByText(/Keep mine/i)).toBeTruthy()
    expect(screen.getByText(/Keep theirs/i)).toBeTruthy()
    expect(screen.getByText(/Keep both/i)).toBeTruthy()
    expect(screen.getByText(/Edit/i)).toBeTruthy()
  })
})

describe('ActionBar — shows Confirm button when pendingResolution is set', () => {
  it('shows Confirm button when pendingResolution is set', () => {
    render(
      <ActionBar
        pendingResolution={{ text: 'x', strategy: 'ours' }}
        onKeepMine={vi.fn()}
        onKeepTheirs={vi.fn()}
        onKeepBoth={vi.fn()}
        onEdit={vi.fn()}
        onConfirm={vi.fn()}
      />
    )
    expect(screen.getByText(/Confirm/i)).toBeTruthy()
  })
})

describe('ActionBar — hides Confirm when no pendingResolution', () => {
  it('hides Confirm when no pendingResolution', () => {
    render(
      <ActionBar
        pendingResolution={null}
        onKeepMine={vi.fn()}
        onKeepTheirs={vi.fn()}
        onKeepBoth={vi.fn()}
        onEdit={vi.fn()}
        onConfirm={vi.fn()}
      />
    )
    expect(screen.queryByText(/Confirm/i)).toBeNull()
  })
})

describe('ActionBar — calls onKeepMine when button clicked', () => {
  it('calls onKeepMine when button clicked', () => {
    const onKeepMine = vi.fn()
    render(
      <ActionBar
        pendingResolution={null}
        onKeepMine={onKeepMine}
        onKeepTheirs={vi.fn()}
        onKeepBoth={vi.fn()}
        onEdit={vi.fn()}
        onConfirm={vi.fn()}
      />
    )
    fireEvent.click(screen.getByText(/Keep mine/i))
    expect(onKeepMine).toHaveBeenCalledOnce()
  })
})
