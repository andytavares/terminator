import { create } from 'zustand'
import type { GitStatus, FileDiff } from '../schemas/git.schema'

interface GitStore {
  status: GitStatus | null
  selectedFile: string | null
  diffCache: Map<string, FileDiff>
  isLoading: boolean
  view: 'default' | 'merge-flow'
  setStatus(status: GitStatus | null): void
  setSelectedFile(path: string | null): void
  setDiff(path: string, diff: FileDiff): void
  setLoading(loading: boolean): void
  clearDiffCache(): void
  setView(view: 'default' | 'merge-flow'): void
}

export const useGitStore = create<GitStore>((set) => ({
  status: null,
  selectedFile: null,
  diffCache: new Map(),
  isLoading: false,
  view: 'default',
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
  setView: (view) => set({ view }),
}))
