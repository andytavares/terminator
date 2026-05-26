import { render, screen, fireEvent } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import React from 'react'

const mockResolveConflict = vi.fn()
const mockPersistSession = vi.fn()
const mockUndoResolve = vi.fn()

vi.mock('../../src/api/merge-flow', () => ({
  mergeFlowAPI: {
    resolveConflict: (...a: unknown[]) => mockResolveConflict(...a),
    persistSession: (...a: unknown[]) => mockPersistSession(...a),
    undoResolve: (...a: unknown[]) => mockUndoResolve(...a),
  },
}))

vi.mock('../../../../src/renderer/stores/toast.store', () => ({
  useToastStore: () => ({ addToast: vi.fn() }),
}))

let mockStoreState: Record<string, unknown> = {}
vi.mock('../../src/stores/merge-flow.store', () => ({
  useMergeFlowStore: (selector?: (s: unknown) => unknown) => {
    if (typeof selector === 'function') return selector(mockStoreState)
    return mockStoreState
  },
}))

// ManualEditor now uses CodeMirror — shim it with a plain textarea for tests
vi.mock('../../src/components/merge-flow/ManualEditor', () => {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const React = require('react')
  const CONFLICT_MARKER_RE = /^(<{7}.*|={7}|>{7}.*)\n?/gm
  function strip(t: string) {
    return t.replace(CONFLICT_MARKER_RE, '')
  }
  function pick(block: Record<string, unknown>) {
    if (block.isResolved && block.resolvedText) return block.resolvedText as string
    const o = strip(String(block.oursText ?? ''))
    const t = strip(String(block.theirsText ?? ''))
    return o.length > t.length ? o : t
  }
  function ManualEditor({
    block,
    onSave,
    onCancel,
  }: {
    block: Record<string, unknown>
    onSave: (t: string) => void
    onCancel: () => void
  }) {
    const [text, setText] = React.useState(pick(block))
    return React.createElement(
      'div',
      { className: 'manual-editor' },
      React.createElement('button', { onClick: onCancel }, 'Cancel'),
      React.createElement('textarea', {
        value: text,
        onChange: (e: React.ChangeEvent<HTMLTextAreaElement>) => setText(e.target.value),
      }),
      React.createElement(
        'button',
        { onClick: () => onSave(text), disabled: !text.trim() },
        'Save & confirm'
      )
    )
  }
  return { ManualEditor }
})

import { ConflictPanel } from '../../src/components/merge-flow/ConflictPanel'
import { ActionBar } from '../../src/components/merge-flow/ActionBar'
import { ResultPreviewStrip } from '../../src/components/merge-flow/ResultPreviewStrip'
import { KeepBothModal } from '../../src/components/merge-flow/KeepBothModal'
import { ManualEditor } from '../../src/components/merge-flow/ManualEditor'
import { ConflictHeader } from '../../src/components/merge-flow/ConflictHeader'

const baseBlock = {
  blockId: 'src/foo.ts#0',
  index: 0,
  oursText: 'const x = 1',
  theirsText: 'const x = 2',
  baseText: '',
  contextBefore: ['// before'],
  contextAfter: ['// after'],
  originalConflictText: '<<<<<<< HEAD\nconst x = 1\n=======\nconst x = 2\n>>>>>>> branch',
  isResolved: false,
}

const baseSession = {
  repoRoot: '/repo',
  isRebase: false,
  totalConflicts: 1,
  totalResolved: 0,
  startedAt: '',
  files: [
    {
      filePath: 'src/foo.ts',
      conflictCount: 1,
      resolvedCount: 0,
      conflictDescription: 'desc',
      oursAuthor: { name: 'Alice', commitHash: 'abc', timestamp: '' },
      theirsAuthor: { name: 'Bob', commitHash: 'def', timestamp: '' },
      blocks: [baseBlock],
    },
  ],
}

beforeEach(() => {
  vi.clearAllMocks()
  mockResolveConflict.mockResolvedValue({ success: true })
  mockPersistSession.mockResolvedValue({ success: true })
  mockUndoResolve.mockResolvedValue({ success: true })
  mockStoreState = {
    session: baseSession,
    activeFileIndex: 0,
    activeBlockIndex: 0,
    isKeepBothOpen: false,
    goToNextBlock: vi.fn(),
    goToPrevBlock: vi.fn(),
    openKeepBoth: vi.fn(),
    closeKeepBoth: vi.fn(),
    confirmDecision: vi.fn(),
    undoLastDecision: vi.fn(),
  }
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

describe('KeepBothModal', () => {
  it('renders preview of both sides', () => {
    const { container } = render(
      <KeepBothModal block={baseBlock} onConfirm={vi.fn()} onCancel={vi.fn()} />
    )
    expect(container.textContent).toContain('const x = 1')
    expect(container.textContent).toContain('const x = 2')
  })

  it('calls onConfirm with merged text when confirmed', () => {
    const onConfirm = vi.fn()
    render(<KeepBothModal block={baseBlock} onConfirm={onConfirm} onCancel={vi.fn()} />)
    fireEvent.click(screen.getByText(/Use this order/i))
    expect(onConfirm).toHaveBeenCalledWith(
      expect.stringContaining('const x = 1'),
      'both-ours-first'
    )
  })

  it('calls onCancel when cancelled', () => {
    const onCancel = vi.fn()
    render(<KeepBothModal block={baseBlock} onConfirm={vi.fn()} onCancel={onCancel} />)
    fireEvent.click(screen.getByText(/Cancel/i))
    expect(onCancel).toHaveBeenCalledOnce()
  })
})

describe('ManualEditor', () => {
  it('renders textarea with initial text', () => {
    render(<ManualEditor block={baseBlock} onSave={vi.fn()} onCancel={vi.fn()} />)
    const textarea = screen.getByRole('textbox') as HTMLTextAreaElement
    // equal-length ours/theirs → theirs wins per heuristic
    expect(textarea.value).toContain('const x = 2')
  })

  it('calls onSave with edited text', () => {
    const onSave = vi.fn()
    render(<ManualEditor block={baseBlock} onSave={onSave} onCancel={vi.fn()} />)
    const textarea = screen.getByRole('textbox')
    fireEvent.change(textarea, { target: { value: 'const x = 42' } })
    fireEvent.click(screen.getByRole('button', { name: /Save/i }))
    expect(onSave).toHaveBeenCalledWith('const x = 42')
  })

  it('calls onCancel when cancelled', () => {
    const onCancel = vi.fn()
    render(<ManualEditor block={baseBlock} onSave={vi.fn()} onCancel={onCancel} />)
    fireEvent.click(screen.getByText(/Cancel/i))
    expect(onCancel).toHaveBeenCalledOnce()
  })
})

describe('ConflictHeader', () => {
  it('renders breadcrumb with filename and progress', () => {
    const { container } = render(
      <ConflictHeader
        onBack={vi.fn()}
        onUndo={vi.fn()}
        canUndo={false}
        onPrev={vi.fn()}
        onNext={vi.fn()}
        canPrev={false}
        canNext={false}
      />
    )
    expect(container.textContent).toContain('foo.ts')
    expect(screen.getByText(/Conflict 1 of 1/)).toBeTruthy()
  })

  it('calls onBack when back button clicked', () => {
    const onBack = vi.fn()
    render(
      <ConflictHeader
        onBack={onBack}
        onUndo={vi.fn()}
        canUndo={false}
        onPrev={vi.fn()}
        onNext={vi.fn()}
        canPrev={false}
        canNext={false}
      />
    )
    fireEvent.click(screen.getByText(/Files/i))
    expect(onBack).toHaveBeenCalledOnce()
  })

  it('calls onUndo when undo button clicked', () => {
    const onUndo = vi.fn()
    render(
      <ConflictHeader
        onBack={vi.fn()}
        onUndo={onUndo}
        canUndo={true}
        onPrev={vi.fn()}
        onNext={vi.fn()}
        canPrev={false}
        canNext={false}
      />
    )
    fireEvent.click(screen.getByText(/Undo/i))
    expect(onUndo).toHaveBeenCalledOnce()
  })

  it('renders progress dots for each block', () => {
    const { container } = render(
      <ConflictHeader
        onBack={vi.fn()}
        onUndo={vi.fn()}
        canUndo={false}
        onPrev={vi.fn()}
        onNext={vi.fn()}
        canPrev={false}
        canNext={false}
      />
    )
    const dots = container.querySelectorAll('.conflict-header__dot')
    expect(dots.length).toBe(1) // 1 block in base session
  })
})
