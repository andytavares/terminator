import { useEffect } from 'react'
import { useGitStore } from '../stores/git.store'
import type { GitStatus } from '../schemas/git.schema'

export function useGitStatus(repoRoot: string | null, refreshIntervalMs = 3000): void {
  const { setStatus, setLoading } = useGitStore()

  useEffect(() => {
    if (!repoRoot) {
      setStatus(null)
      return
    }

    let cancelled = false

    async function refresh(): Promise<void> {
      if (cancelled) return
      try {
        const result = await window.electronAPI.git.status(repoRoot!) as
          | GitStatus
          | { error: string }
        if (!cancelled) {
          if ('error' in result) setStatus(null)
          else setStatus(result as unknown as GitStatus)
        }
      } catch {
        if (!cancelled) setStatus(null)
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    setLoading(true)
    void refresh()

    const unsubFs = window.electronAPI.fs.onChanged(() => void refresh())
    const interval = setInterval(() => void refresh(), refreshIntervalMs)

    return () => {
      cancelled = true
      unsubFs()
      clearInterval(interval)
    }
  }, [repoRoot, refreshIntervalMs])
}
