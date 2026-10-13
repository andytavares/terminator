import { describe, it, expect, beforeEach } from 'vitest'
import { act } from '@testing-library/react'
import { useMergeFlowStore } from '../../src/stores/merge-flow.store'
import type { ConflictSession, ConflictResolution } from '../../src/schemas/merge-flow.schema'

type ConflictFile = ConflictSession['files'][number]
type Block = ConflictFile['blocks'][number]

/** An unresolved block of `filePath`, numbered `index`, with the given sides and conflict text. */
function makeBlock(
  filePath: string,
  index: number,
  texts: Pick<Block, 'oursText' | 'theirsText' | 'originalConflictText'>
): Block {
  return {
    blockId: `${filePath}#${index}`,
    index,
    baseText: '',
    contextBefore: [],
    contextAfter: [],
    isResolved: false,
    ...texts,
  }
}

/** An unresolved file holding `blocks`, by authors at the given commits. */
function makeFile(
  filePath: string,
  blocks: Block[],
  authors: Pick<ConflictFile, 'oursAuthor' | 'theirsAuthor' | 'conflictDescription'>
): ConflictFile {
  return { filePath, conflictCount: blocks.length, resolvedCount: 0, blocks, ...authors }
}

function makeSession(overrides: Partial<ConflictSession> = {}): ConflictSession {
  const foo = 'src/foo.ts'
  const blocks = [0, 1].map((i) =>
    makeBlock(foo, i, {
      oursText: `ours${i}`,
      theirsText: `theirs${i}`,
      originalConflictText: '<<<',
    })
  )
  const authors = {
    conflictDescription: 'desc',
    oursAuthor: { name: 'Alice', commitHash: 'abc', timestamp: '2026-01-01T00:00:00Z' },
    theirsAuthor: { name: 'Bob', commitHash: 'def', timestamp: '2026-01-01T00:00:00Z' },
  }
  return {
    repoRoot: '/repo',
    isRebase: false,
    totalConflicts: 2,
    totalResolved: 0,
    startedAt: new Date().toISOString(),
    files: [makeFile(foo, blocks, authors)],
    ...overrides,
  }
}

beforeEach(() => {
  act(() => {
    useMergeFlowStore.getState().clearSession()
  })
})

describe('session lifecycle', () => {
  it('starts with null session', () => {
    expect(useMergeFlowStore.getState().session).toBeNull()
  })

  it('startSession sets session and resets indices', () => {
    const session = makeSession()
    act(() => {
      useMergeFlowStore.getState().startSession(session)
    })
    const state = useMergeFlowStore.getState()
    expect(state.session).toEqual(session)
    expect(state.activeFileIndex).toBe(0)
    expect(state.activeBlockIndex).toBe(0)
  })

  it('clearSession resets all state', () => {
    act(() => {
      useMergeFlowStore.getState().startSession(makeSession())
      useMergeFlowStore.getState().clearSession()
    })
    const state = useMergeFlowStore.getState()
    expect(state.session).toBeNull()
    expect(state.error).toBeNull()
  })
})

describe('navigation', () => {
  it('setActiveFile updates activeFileIndex', () => {
    act(() => {
      useMergeFlowStore.getState().startSession(makeSession())
      useMergeFlowStore.getState().setActiveFile(0)
    })
    expect(useMergeFlowStore.getState().activeFileIndex).toBe(0)
  })

  it('setActiveBlock updates activeBlockIndex', () => {
    act(() => {
      useMergeFlowStore.getState().startSession(makeSession())
      useMergeFlowStore.getState().setActiveBlock(1)
    })
    expect(useMergeFlowStore.getState().activeBlockIndex).toBe(1)
  })

  it('goToNextBlock advances to next block', () => {
    act(() => {
      useMergeFlowStore.getState().startSession(makeSession())
      useMergeFlowStore.getState().goToNextBlock()
    })
    expect(useMergeFlowStore.getState().activeBlockIndex).toBe(1)
  })
})

describe('navigation — goToNextBlock clamps at last block of last file', () => {
  it('goToNextBlock clamps at last block of last file', () => {
    act(() => {
      useMergeFlowStore.getState().startSession(makeSession())
      useMergeFlowStore.getState().setActiveBlock(1)
      useMergeFlowStore.getState().goToNextBlock()
    })
    // Still at last block (no more files)
    expect(useMergeFlowStore.getState().activeBlockIndex).toBe(1)
  })

  it('goToPrevBlock moves back', () => {
    act(() => {
      useMergeFlowStore.getState().startSession(makeSession())
      useMergeFlowStore.getState().setActiveBlock(1)
      useMergeFlowStore.getState().goToPrevBlock()
    })
    expect(useMergeFlowStore.getState().activeBlockIndex).toBe(0)
  })

  it('goToPrevBlock clamps at first block', () => {
    act(() => {
      useMergeFlowStore.getState().startSession(makeSession())
      useMergeFlowStore.getState().goToPrevBlock()
    })
    expect(useMergeFlowStore.getState().activeBlockIndex).toBe(0)
  })
})

describe('confirmDecision', () => {
  it('marks block as resolved and pushes to undo stack', () => {
    const session = makeSession()
    act(() => {
      useMergeFlowStore.getState().startSession(session)
    })
    const resolution: ConflictResolution = {
      blockId: 'src/foo.ts#0',
      resolvedText: 'resolved',
      strategy: 'ours',
    }
    act(() => {
      useMergeFlowStore.getState().confirmDecision('src/foo.ts#0', resolution)
    })
    const state = useMergeFlowStore.getState()
    const block = state.session!.files[0].blocks[0]
    expect(block.isResolved).toBe(true)
    expect(block.resolvedText).toBe('resolved')
    expect(state.session!.totalResolved).toBe(1)
  })
})

describe('undoLastDecision', () => {
  it('returns null when undo stack is empty', () => {
    act(() => {
      useMergeFlowStore.getState().startSession(makeSession())
    })
    const decision = useMergeFlowStore.getState().undoLastDecision()
    expect(decision).toBeNull()
  })
})

describe('undoLastDecision — pops the last decision from undo stack and navigates back to that block', () => {
  it('pops the last decision from undo stack and navigates back to that block', () => {
    const session = makeSession()
    act(() => {
      useMergeFlowStore.getState().startSession(session)
      // Resolve block 0, which advances to block 1
      useMergeFlowStore.getState().confirmDecision('src/foo.ts#0', {
        blockId: 'src/foo.ts#0',
        resolvedText: 'resolved',
        strategy: 'ours',
      })
      useMergeFlowStore.getState().goToNextBlock()
    })
    expect(useMergeFlowStore.getState().activeBlockIndex).toBe(1)

    let decision: ReturnType<typeof useMergeFlowStore.getState.undoLastDecision> | null = null
    act(() => {
      decision = useMergeFlowStore.getState().undoLastDecision()
    })
    expect(decision).not.toBeNull()
    expect(decision!.blockId).toBe('src/foo.ts#0')
    // Block should be un-resolved
    const block = useMergeFlowStore.getState().session!.files[0].blocks[0]
    expect(block.isResolved).toBe(false)
    expect(useMergeFlowStore.getState().session!.totalResolved).toBe(0)
    // Should have navigated back to block 0 in file 0
    expect(useMergeFlowStore.getState().activeFileIndex).toBe(0)
    expect(useMergeFlowStore.getState().activeBlockIndex).toBe(0)
  })
})

describe('UI modals', () => {
  it('openKeepBoth / closeKeepBoth toggles isKeepBothOpen', () => {
    act(() => {
      useMergeFlowStore.getState().openKeepBoth()
    })
    expect(useMergeFlowStore.getState().isKeepBothOpen).toBe(true)
    act(() => {
      useMergeFlowStore.getState().closeKeepBoth()
    })
    expect(useMergeFlowStore.getState().isKeepBothOpen).toBe(false)
  })
})

describe('isComplete selector', () => {
  it('returns true when all conflicts resolved', () => {
    const session = makeSession({ totalConflicts: 0, totalResolved: 0 })
    act(() => {
      useMergeFlowStore.getState().startSession({ ...session, totalConflicts: 2, totalResolved: 2 })
    })
    expect(useMergeFlowStore.getState().session!.totalResolved).toBe(2)
    expect(useMergeFlowStore.getState().session!.totalConflicts).toBe(2)
  })
})

/** A file with one unresolved block whose sides are "<name>-ours" and "<name>-theirs". */
function oneBlockFile(name: string): ConflictFile {
  const filePath = `src/${name}.ts`
  const block = makeBlock(filePath, 0, {
    oursText: `${name}-ours`,
    theirsText: `${name}-theirs`,
    originalConflictText: `<<<${name}>>>`,
  })
  return makeFile(filePath, [block], {
    conflictDescription: '',
    oursAuthor: { name: 'A', commitHash: 'a', timestamp: '2026-01-01T00:00:00Z' },
    theirsAuthor: { name: 'B', commitHash: 'b', timestamp: '2026-01-01T00:00:00Z' },
  })
}

function makeTwoFileSession(): ConflictSession {
  return {
    repoRoot: '/repo',
    isRebase: false,
    totalConflicts: 2,
    totalResolved: 0,
    startedAt: new Date().toISOString(),
    files: [oneBlockFile('alpha'), oneBlockFile('beta')],
  }
}

/** Resolves alpha with "ours", then moves to beta and resolves it with "theirs". */
function resolveBothFiles() {
  act(() => {
    useMergeFlowStore.getState().confirmDecision('src/alpha.ts#0', {
      blockId: 'src/alpha.ts#0',
      resolvedText: 'alpha-resolved',
      strategy: 'ours',
    })
    useMergeFlowStore.getState().setActiveFile(1)
    useMergeFlowStore.getState().confirmDecision('src/beta.ts#0', {
      blockId: 'src/beta.ts#0',
      resolvedText: 'beta-resolved',
      strategy: 'theirs',
    })
  })
}

describe('cross-file undo', () => {
  it('undo on empty stack returns null', () => {
    act(() => {
      useMergeFlowStore.getState().startSession(makeTwoFileSession())
    })
    let result: ReturnType<typeof useMergeFlowStore.getState.prototype.undoLastDecision>
    act(() => {
      result = useMergeFlowStore.getState().undoLastDecision()
    })
    expect(result!).toBeNull()
  })
})

describe('cross-file undo — undo reverses decision in file A after navigating to file B', () => {
  it('undo reverses decision in file A after navigating to file B', () => {
    act(() => {
      useMergeFlowStore.getState().startSession(makeTwoFileSession())
    })
    // Confirm resolution in file A (index 0)
    const resolution: ConflictResolution = {
      blockId: 'src/alpha.ts#0',
      resolvedText: 'resolved-alpha',
      strategy: 'ours',
    }
    act(() => {
      useMergeFlowStore.getState().confirmDecision('src/alpha.ts#0', resolution)
      // Navigate to file B
      useMergeFlowStore.getState().setActiveFile(1)
    })
    expect(useMergeFlowStore.getState().session!.totalResolved).toBe(1)
    expect(useMergeFlowStore.getState().session!.files[0].resolvedCount).toBe(1)

    // Undo while on file B — should reverse file A's decision
    let decision: ReturnType<typeof useMergeFlowStore.getState.prototype.undoLastDecision>
    act(() => {
      decision = useMergeFlowStore.getState().undoLastDecision()
    })
    expect(decision!).not.toBeNull()
    expect(decision!.blockId).toBe('src/alpha.ts#0')
    expect(useMergeFlowStore.getState().session!.totalResolved).toBe(0)
    expect(useMergeFlowStore.getState().session!.files[0].resolvedCount).toBe(0)
    expect(useMergeFlowStore.getState().session!.files[0].blocks[0].isResolved).toBe(false)
    // File B should be unaffected
    expect(useMergeFlowStore.getState().session!.files[1].resolvedCount).toBe(0)
  })
})

describe('cross-file undo — undo reverses only the most recent decision regardless of current activeFile', () => {
  it('undo reverses only the most recent decision regardless of current activeFile', () => {
    act(() => {
      useMergeFlowStore.getState().startSession(makeTwoFileSession())
    })
    resolveBothFiles()
    expect(useMergeFlowStore.getState().session!.totalResolved).toBe(2)

    // Navigate back to file A, then undo — should undo file B's decision (most recent)
    act(() => {
      useMergeFlowStore.getState().setActiveFile(0)
    })
    let decision: ReturnType<typeof useMergeFlowStore.getState.prototype.undoLastDecision>
    act(() => {
      decision = useMergeFlowStore.getState().undoLastDecision()
    })
    expect(decision!.blockId).toBe('src/beta.ts#0')
    expect(useMergeFlowStore.getState().session!.totalResolved).toBe(1)
    expect(useMergeFlowStore.getState().session!.files[1].resolvedCount).toBe(0)
    // File A's resolution should remain
    expect(useMergeFlowStore.getState().session!.files[0].resolvedCount).toBe(1)
  })
})
