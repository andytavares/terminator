import { useEffect } from 'react'
import { useGitStore } from '../stores/git.store'
import type { GitStatus } from '../schemas/git.schema'
import { gitAPI } from '../api/git'

interface StatusSink {
  setStatus: (status: GitStatus | null) => void
  setDisabled: (disabled: boolean) => void
  setLoading: (loading: boolean) => void
}

type StatusAnswer = GitStatus | { error: string }

/** Keeps the status, or none for an error, and whether the workspace switched the extension off. */
function keepStatus(sink: StatusSink, result: StatusAnswer): void {
  sink.setDisabled('error' in result && result.error === 'GIT_DISABLED')
  sink.setStatus('error' in result ? null : result)
}

/** A refresh that never overlaps itself and stops writing once `isCancelled` says so. */
function statusRefresher(repoRoot: string, sink: StatusSink, isCancelled: () => boolean) {
  let inFlight = false
  return async function refresh(): Promise<void> {
    if (isCancelled() || inFlight) return
    inFlight = true
    try {
      const result = (await gitAPI.status(repoRoot)) as StatusAnswer
      if (!isCancelled()) keepStatus(sink, result)
    } catch {
      if (!isCancelled()) sink.setStatus(null)
    } finally {
      inFlight = false
      if (!isCancelled()) sink.setLoading(false)
    }
  }
}

/** Refreshes on file changes, on an interval while visible, and when the view becomes visible. */
function pollStatus(refresh: () => Promise<void>, intervalMs: number): () => void {
  const unsubFs = window.electronAPI.fs.onChanged(() => void refresh())
  const interval = setInterval(() => {
    if (document.visibilityState !== 'hidden') void refresh()
  }, intervalMs)
  const onVisibility = () => {
    if (document.visibilityState === 'visible') void refresh()
  }
  document.addEventListener('visibilitychange', onVisibility)
  return () => {
    unsubFs()
    clearInterval(interval)
    document.removeEventListener('visibilitychange', onVisibility)
  }
}

export function useGitStatus(repoRoot: string | null, refreshIntervalMs = 3000): void {
  const setStatus = useGitStore((s) => s.setStatus)
  const setDisabled = useGitStore((s) => s.setDisabled)
  const setLoading = useGitStore((s) => s.setLoading)
  useEffect(() => {
    if (!repoRoot) {
      setStatus(null)
      return
    }
    let cancelled = false
    const sink = { setStatus, setDisabled, setLoading }
    const refresh = statusRefresher(repoRoot, sink, () => cancelled)
    setLoading(true)
    void refresh()
    const stopPolling = pollStatus(refresh, refreshIntervalMs)
    return () => {
      cancelled = true
      stopPolling()
    }
  }, [repoRoot, refreshIntervalMs, setStatus, setDisabled, setLoading])
}
