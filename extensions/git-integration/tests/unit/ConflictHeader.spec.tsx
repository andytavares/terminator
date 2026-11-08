import { render, screen, fireEvent } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import React from 'react'

let mockStoreState: Record<string, unknown> = {}
vi.mock('../../src/stores/merge-flow.store', () => ({
  useMergeFlowStore: (selector?: (s: unknown) => unknown) => {
    if (typeof selector === 'function') return selector(mockStoreState)
    return mockStoreState
  },
}))

import { ConflictHeader } from '../../src/components/merge-flow/ConflictHeader'

const baseSession = {
  repoRoot: '/repo',
  isRebase: false,
  totalConflicts: 2,
  totalResolved: 0,
  startedAt: '',
  files: [
    {
      filePath: 'src/foo.ts',
      conflictCount: 2,
      resolvedCount: 0,
      conflictDescription: '',
      oursAuthor: { name: 'A', commitHash: 'a', timestamp: '' },
      theirsAuthor: { name: 'B', commitHash: 'b', timestamp: '' },
      blocks: [
        {
          blockId: 'src/foo.ts#0',
          index: 0,
          oursText: 'ours0',
          theirsText: 'theirs0',
          baseText: '',
          contextBefore: [],
          contextAfter: [],
          originalConflictText: '<<<',
          isResolved: false,
        },
        {
          blockId: 'src/foo.ts#1',
          index: 1,
          oursText: 'ours1',
          theirsText: 'theirs1',
          baseText: '',
          contextBefore: [],
          contextAfter: [],
          originalConflictText: '<<<',
          isResolved: true,
        },
      ],
    },
  ],
}

beforeEach(() => {
  vi.clearAllMocks()
  mockStoreState = {
    activeFileIndex: 0,
    activeBlockIndex: 0,
    _undoStack: [],
  }
})

describe('ConflictHeader', () => {
  it('renders filename and progress', () => {
    const { container } = render(
      <ConflictHeader
        session={baseSession}
        onBack={vi.fn()}
        onUndo={vi.fn()}
        canUndo={false}
        onPrev={vi.fn()}
        onNext={vi.fn()}
        canPrev={false}
        canNext={true}
      />
    )
    expect(container.textContent).toContain('src/')
    expect(container.textContent).toContain('foo.ts')
    expect(screen.getByText(/Conflict 1 of 2/)).toBeTruthy()
  })
})

describe('ConflictHeader — progress dots', () => {
  it('renders one dot per block and marks only the resolved block', () => {
    const { container } = render(
      <ConflictHeader
        session={baseSession}
        onBack={vi.fn()}
        onUndo={vi.fn()}
        canUndo={false}
        onPrev={vi.fn()}
        onNext={vi.fn()}
        canPrev={false}
        canNext={true}
      />
    )
    const dots = Array.from(container.querySelectorAll('.conflict-header__dot'))
    expect(dots.map((dot) => dot.classList.contains('conflict-header__dot--resolved'))).toEqual([
      false,
      true,
    ])
  })
})

describe('ConflictHeader — calls onBack when Files button clicked', () => {
  it('calls onBack when Files button clicked', () => {
    const onBack = vi.fn()
    render(
      <ConflictHeader
        session={baseSession}
        onBack={onBack}
        onUndo={vi.fn()}
        canUndo={false}
        onPrev={vi.fn()}
        onNext={vi.fn()}
        canPrev={false}
        canNext={true}
      />
    )
    fireEvent.click(screen.getByText(/Files/i))
    expect(onBack).toHaveBeenCalledOnce()
  })
})

describe('ConflictHeader — calls onUndo when Undo button clicked', () => {
  it('calls onUndo when Undo button clicked', () => {
    const onUndo = vi.fn()
    render(
      <ConflictHeader
        session={baseSession}
        onBack={vi.fn()}
        onUndo={onUndo}
        canUndo={true}
        onPrev={vi.fn()}
        onNext={vi.fn()}
        canPrev={false}
        canNext={true}
      />
    )
    fireEvent.click(screen.getByText(/Undo/i))
    expect(onUndo).toHaveBeenCalledOnce()
  })
})

describe('ConflictHeader — Undo button state', () => {
  it.each([
    { canUndo: false, disabled: true },
    { canUndo: true, disabled: false },
  ])('sets Undo disabled to $disabled when canUndo is $canUndo', ({ canUndo, disabled }) => {
    render(
      <ConflictHeader
        session={baseSession}
        onBack={vi.fn()}
        onUndo={vi.fn()}
        canUndo={canUndo}
        onPrev={vi.fn()}
        onNext={vi.fn()}
        canPrev={false}
        canNext={false}
      />
    )
    const undoBtn = screen.getByText(/Undo/i).closest('button') as HTMLButtonElement
    expect(undoBtn.disabled).toBe(disabled)
  })
})

describe('ConflictHeader — calls onExit when exit button is clicked', () => {
  it('calls onExit when exit button is clicked', () => {
    const onExit = vi.fn()
    render(
      <ConflictHeader
        session={baseSession}
        onBack={vi.fn()}
        onUndo={vi.fn()}
        canUndo={false}
        onPrev={vi.fn()}
        onNext={vi.fn()}
        canPrev={false}
        canNext={false}
        onExit={onExit}
      />
    )
    fireEvent.click(screen.getByLabelText(/exit merge flow/i))
    expect(onExit).toHaveBeenCalledOnce()
  })
})

describe('ConflictHeader — does not show exit button when onExit is not provided', () => {
  it('does not show exit button when onExit is not provided', () => {
    render(
      <ConflictHeader
        session={baseSession}
        onBack={vi.fn()}
        onUndo={vi.fn()}
        canUndo={false}
        onPrev={vi.fn()}
        onNext={vi.fn()}
        canPrev={false}
        canNext={false}
      />
    )
    expect(screen.queryByLabelText(/exit merge flow/i)).toBeNull()
  })
})
