import { useEffect } from 'react'
import type { Project } from '../../shared/types/index'
import { useWorkspaceStore } from '../stores/workspace.store'

/**
 * Keeps project.gitBranch in sync with the actual branch in the working tree.
 * Skipped entirely for worktree projects — their branch is fixed at creation time.
 */
export function useBranchSync(project: Project, cwd: string): void {
  const { updateProjectBranch } = useWorkspaceStore()

  useEffect(() => {
    if (project.isWorktree) return

    let cancelled = false

    async function check(): Promise<void> {
      if (cancelled) return
      try {
        const result = await window.electronAPI.git.currentBranch(cwd)
        if (!cancelled && 'branch' in result && result.branch !== project.gitBranch) {
          await updateProjectBranch(project.id, result.branch)
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
