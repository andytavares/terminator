import { useEffect } from 'react'
import { useWorkspaceStore } from '../stores/workspace.store'

/** How often a tracked tree is asked what branch it is on. */
const POLL_MS = 5000

/** One working tree to keep a branch card's name honest about. */
export interface BranchSyncTarget {
  id: string
  /** The working tree whose HEAD this card claims to be on. */
  cwd: string
  gitBranch?: string
}

/**
 * Keeps each branch card's `gitBranch` equal to the branch its working tree is
 * actually on.
 *
 * A card is named by its branch (ADR-034), so a stale `gitBranch` is not an
 * internal detail — it is the wrong name on screen. Nothing else updates it:
 * a worktree's branch is fixed when it is created, and the only checkout a
 * plain card can see now happens in its own terminal.
 *
 * Polled, because there is no event to listen to. `fs.onChanged` looks like the
 * right seam and is not: nothing in the app calls `fs.watchStart`, so `fs:changed`
 * never fires and a subscription to it would be decoration. `git branch
 * --show-current` reads `.git/HEAD` and is cheap enough to ask for on a timer;
 * a hidden window is not asked at all.
 *
 * Worktree cards are not passed here. Every other card is checked against its
 * own tree, so two cards sharing a folder both land on the branch that folder
 * is on without one having to tell the other.
 */
export function useBranchSync(targets: readonly BranchSyncTarget[]): void {
  const { updateProjectBranch } = useWorkspaceStore()
  // The caller rebuilds this array every render. Keying the effect on what the
  // targets say — rather than on the array's identity — is what stops the timer
  // being torn down and restarted on every keystroke elsewhere in the app.
  const key = targets.map((t) => `${t.id} ${t.cwd} ${t.gitBranch ?? ''}`).join('')

  useEffect(() => {
    if (targets.length === 0) return

    let cancelled = false

    async function check(): Promise<void> {
      if (document.visibilityState === 'hidden') return
      for (const target of targets) {
        if (cancelled) return
        try {
          const result = await window.electronAPI.git.currentBranch(target.cwd)
          if (!cancelled && 'branch' in result && result.branch !== target.gitBranch) {
            await updateProjectBranch(target.id, result.branch)
          }
        } catch {
          // A folder that is not a repository is an ordinary case here, not a
          // failure worth a notification.
        }
      }
    }

    void check()
    const timer = setInterval(() => void check(), POLL_MS)

    return () => {
      cancelled = true
      clearInterval(timer)
    }
    // `targets` is read through `key`, which is what actually changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, updateProjectBranch])
}
