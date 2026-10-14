import { create } from 'zustand'

// The open modal shells of this document, oldest first. A native modal dialog makes everything
// outside it inert and paints over it, so a toast has to render inside the one on top.
const useModalStack = create<{ open: readonly HTMLDialogElement[] }>(() => ({ open: [] }))

/** Records an opened shell and returns the function that removes it. */
export function enterModalStack(dialog: HTMLDialogElement): () => void {
  useModalStack.setState((stack) => ({ open: [...stack.open, dialog] }))
  return () => {
    useModalStack.setState((stack) => ({ open: stack.open.filter((other) => other !== dialog) }))
  }
}

/** The modal shell opened last, or null while none is open. */
export function useTopModal(): HTMLDialogElement | null {
  return useModalStack((stack) => stack.open[stack.open.length - 1] ?? null)
}
