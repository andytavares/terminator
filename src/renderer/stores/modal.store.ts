import { useEffect } from 'react'
import { create } from 'zustand'

interface ModalStore {
  depth: number
  push(): void
  pop(): void
}

export const useModalStore = create<ModalStore>((set) => ({
  depth: 0,
  push: () => set((s) => ({ depth: s.depth + 1 })),
  pop: () => set((s) => ({ depth: Math.max(0, s.depth - 1) })),
}))

/** Call inside any modal component to suppress extension WebContentsViews while open. */
export function useModalEffect(): void {
  const { push, pop } = useModalStore()
  useEffect(() => {
    push()
    return pop
  }, [push, pop])
}
