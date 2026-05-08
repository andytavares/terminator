import { create } from 'zustand'
import type { GitStatus, FileDiff } from '../../../../src/shared/schemas/git.schema'

interface GitStore {
  status: GitStatus | null
  selectedFile: string | null
  diffCache: Map<string, FileDiff>
  isLoading: boolean
  setStatus(status: GitStatus | null): void
  setSelectedFile(path: string | null): void
  setDiff(path: string, diff: FileDiff): void
  setLoading(loading: boolean): void
  clearDiffCache(): void
}

export const useGitStore = create<GitStore>((set) => ({
  status: null,
  selectedFile: null,
  diffCache: new Map(),
  isLoading: false,
  setStatus: (status) => set({ status }),
  setSelectedFile: (selectedFile) => set({ selectedFile }),
  setDiff: (path, diff) =>
    set((state) => {
      const next = new Map(state.diffCache)
      next.set(path, diff)
      return { diffCache: next }
    }),
  setLoading: (isLoading) => set({ isLoading }),
  clearDiffCache: () => set({ diffCache: new Map() }),
}))
