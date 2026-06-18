import { useEffect } from 'react'
import type { Project } from '../../shared/types/index'
import { useWorkspaceStore } from '../stores/workspace.store'

/**
 * Keeps project.gitBranch in sync with the actual branch in the working tree.
 * Skipped entirely for worktree projects — their branch is fixed at creation time.
 * When a branch-based project's branch changes, all other branch-based projects
 * in the same workspace are also updated (they share the same folderPath).
 */
export function useBranchSync(project: Project, cwd: string): void {
  const { updateProjectBranch } = useWorkspaceStore()

  useEffect(() => {
    if (project.isWorktree || !cwd) return

    let cancelled = false

    async function check(): Promise<void> {
      if (cancelled) return
      try {
        const result = await window.electronAPI.git.currentBranch(cwd)
        if (!cancelled && 'branch' in result && result.branch !== project.gitBranch) {
          await updateProjectBranch(project.id, result.branch)

          // Propagate to all other non-worktree projects in the same workspace.
          // Read state imperatively to avoid adding these as reactive deps.
          const { workspaces, projectsByWorkspaceId } = useWorkspaceStore.getState()
          const workspace = workspaces.find((w) =>
            (projectsByWorkspaceId.get(w.id) ?? []).some((p) => p.id === project.id)
          )
          if (workspace) {
            const siblings = (projectsByWorkspaceId.get(workspace.id) ?? []).filter(
              (p) => p.id !== project.id && !p.isWorktree && p.gitBranch !== result.branch
            )
            for (const sibling of siblings) {
              if (!cancelled) await updateProjectBranch(sibling.id, result.branch)
            }
          }
        }
      } catch {
        // non-git dirs are a normal occurrence; ignore silently
      }
    }

    void check()

    const unsubFs = window.electronAPI.fs.onChanged(() => void check())

    return () => {
      cancelled = true
      unsubFs()
    }
  }, [project.id, project.gitBranch, project.isWorktree, cwd, updateProjectBranch])
}
