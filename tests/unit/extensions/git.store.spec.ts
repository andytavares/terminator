import { describe, it, expect, beforeEach } from 'vitest'
import { useGitStore } from '../../../extensions/git-integration/src/stores/git.store'
import type {
  GitStatus,
  FileDiff,
} from '../../../extensions/git-integration/src/schemas/git.schema'

function resetStore() {
  useGitStore.setState({
    status: null,
    selectedFile: null,
    diffCache: new Map(),
    isLoading: false,
  })
}

const validStatus: GitStatus = {
  branch: 'main',
  files: [{ path: 'src/app.ts', status: 'modified', staged: true, isBinary: false }],
  hasConflicts: false,
  truncated: false,
}

const validDiff: FileDiff = {
  path: 'src/app.ts',
  hunks: [],
  isBinary: false,
  truncated: false,
}

describe('useGitStore', () => {
  beforeEach(resetStore)

  describe('setStatus', () => {
    it('stores the given status', () => {
      useGitStore.getState().setStatus(validStatus)
      expect(useGitStore.getState().status).toEqual(validStatus)
    })

    it('clears status when set to null', () => {
      useGitStore.setState({ status: validStatus })
      useGitStore.getState().setStatus(null)
      expect(useGitStore.getState().status).toBeNull()
    })
  })

  describe('setSelectedFile', () => {
    it('stores the selected file path', () => {
      useGitStore.getState().setSelectedFile('src/app.ts')
      expect(useGitStore.getState().selectedFile).toBe('src/app.ts')
    })

    it('clears selected file when set to null', () => {
      useGitStore.setState({ selectedFile: 'src/app.ts' })
      useGitStore.getState().setSelectedFile(null)
      expect(useGitStore.getState().selectedFile).toBeNull()
    })
  })

  describe('setDiff', () => {
    it('adds diff to cache by path', () => {
      useGitStore.getState().setDiff('src/app.ts', validDiff)
      expect(useGitStore.getState().diffCache.get('src/app.ts')).toEqual(validDiff)
    })

    it('stores multiple diffs independently', () => {
      const diff2: FileDiff = { ...validDiff, path: 'src/util.ts' }
      useGitStore.getState().setDiff('src/app.ts', validDiff)
      useGitStore.getState().setDiff('src/util.ts', diff2)
      expect(useGitStore.getState().diffCache.size).toBe(2)
    })

    it('overwrites existing diff for the same path', () => {
      useGitStore.getState().setDiff('src/app.ts', validDiff)
      const updated = { ...validDiff, isBinary: true }
      useGitStore.getState().setDiff('src/app.ts', updated)
      expect(useGitStore.getState().diffCache.get('src/app.ts')?.isBinary).toBe(true)
    })
  })

  describe('setLoading', () => {
    it('sets isLoading to true', () => {
      useGitStore.getState().setLoading(true)
      expect(useGitStore.getState().isLoading).toBe(true)
    })

    it('sets isLoading to false', () => {
      useGitStore.setState({ isLoading: true })
      useGitStore.getState().setLoading(false)
      expect(useGitStore.getState().isLoading).toBe(false)
    })
  })

  describe('clearDiffCache', () => {
    it('removes all cached diffs', () => {
      useGitStore.getState().setDiff('src/a.ts', validDiff)
      useGitStore.getState().setDiff('src/b.ts', validDiff)
      useGitStore.getState().clearDiffCache()
      expect(useGitStore.getState().diffCache.size).toBe(0)
    })
  })
})
