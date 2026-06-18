import { create } from 'zustand'
import type { Comment } from '../db/types'

interface CommentsState {
  comments: Comment[]
  loading: boolean
  setComments: (comments: Comment[]) => void
  addComment: (comment: Comment) => void
  removeComment: (id: string) => void
  updateComment: (id: string, patch: Partial<Comment>) => void
  setLoading: (loading: boolean) => void
}

export const useCommentsStore = create<CommentsState>((set) => ({
  comments: [],
  loading: false,
  setComments: (comments) => set({ comments }),
  addComment: (comment) => set((s) => ({ comments: [...s.comments, comment] })),
  removeComment: (id) => set((s) => ({ comments: s.comments.filter((c) => c.id !== id) })),
  updateComment: (id, patch) =>
    set((s) => ({
      comments: s.comments.map((c) => (c.id === id ? { ...c, ...patch } : c)),
    })),
  setLoading: (loading) => set({ loading }),
}))
