import { describe, it, expect, beforeEach } from 'vitest'
import { useGitStore } from '../../src/stores/git.store'
import type { FileDiff, GitStatus } from '../../src/schemas/git.schema'

const status = (over: Partial<GitStatus> = {}): GitStatus =>
  ({
    branch: 'main',
    files: [{ path: 'src/a.ts', status: 'modified', staged: false, isBinary: false }],
    truncated: false,
    hasConflicts: false,
    ...over,
  }) as GitStatus

const diff = (path: string): FileDiff => ({ path, hunks: [], isBinary: false, truncated: false })

describe('git store setStatus', () => {
  beforeEach(() => {
    useGitStore.setState({ status: null, diffCache: new Map() })
  })

  it('keeps the same status object when a poll returns identical content', () => {
    useGitStore.getState().setStatus(status())
    const first = useGitStore.getState().status
    useGitStore.getState().setDiff('unstaged:src/a.ts', diff('src/a.ts'))
    useGitStore.getState().setStatus(status())
    expect(useGitStore.getState().status).toBe(first)
    expect(useGitStore.getState().diffCache.has('unstaged:src/a.ts')).toBe(true)
  })

  it('replaces the status and clears cached diffs when a file changes state', () => {
    useGitStore.getState().setStatus(status())
    useGitStore.getState().setDiff('unstaged:src/a.ts', diff('src/a.ts'))
    const staged = status({
      files: [{ path: 'src/a.ts', status: 'modified', staged: true, isBinary: false }],
    })
    useGitStore.getState().setStatus(staged)
    expect(useGitStore.getState().status).toBe(staged)
    expect(useGitStore.getState().diffCache.size).toBe(0)
  })

  it('clears cached diffs when the branch changes', () => {
    useGitStore.getState().setStatus(status())
    useGitStore.getState().setDiff('unstaged:src/a.ts', diff('src/a.ts'))
    useGitStore.getState().setStatus(status({ branch: 'feature' }))
    expect(useGitStore.getState().diffCache.size).toBe(0)
  })

  it('treats a null to null update as no change', () => {
    const before = useGitStore.getState()
    useGitStore.getState().setStatus(null)
    expect(useGitStore.getState().status).toBeNull()
    expect(before.diffCache).toBe(useGitStore.getState().diffCache)
  })
})
