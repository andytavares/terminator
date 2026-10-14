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

/** How often status is read where no watch can be had: the remote browser client. */
const UNWATCHED_READ_MS = 3000

/** Keeps the status, or none for an error, and whether the workspace switched the extension off. */
function keepStatus(sink: StatusSink, result: StatusAnswer): void {
  sink.setDisabled('error' in result && result.error === 'GIT_DISABLED')
  sink.setStatus('error' in result ? null : result)
}

async function readStatus(repoRoot: string, sink: StatusSink, isCancelled: () => boolean) {
  try {
    const result = (await gitAPI.status(repoRoot)) as StatusAnswer
    if (!isCancelled()) keepStatus(sink, result)
  } catch {
    if (!isCancelled()) sink.setStatus(null)
  } finally {
    if (!isCancelled()) sink.setLoading(false)
  }
}

/** A refresh that never overlaps itself: asked for during a read, it reads once more after it,
 * so a change the running read was too early to see is not lost. */
function statusRefresher(repoRoot: string, sink: StatusSink, isCancelled: () => boolean) {
  let reading = false
  let askedMeanwhile = false
  return async function refresh(): Promise<void> {
    if (isCancelled()) return
    if (reading) {
      askedMeanwhile = true
      return
    }
    reading = true
    await readStatus(repoRoot, sink, isCancelled)
    reading = false
    if (!askedMeanwhile) return
    askedMeanwhile = false
    await refresh()
  }
}

/** The git directory is watched too where it is outside the folder; the folder alone is, where
 * git cannot say (not a repository, or the remote client, which has no such channel). */
async function watchRootsOf(repoRoot: string): Promise<string[]> {
  try {
    const answer = await gitAPI.watchRoots(repoRoot)
    return 'roots' in answer ? answer.roots : [repoRoot]
  } catch {
    return [repoRoot]
  }
}

/** Starts the watches of `repoRoot`. False when one did not start, as none does remotely. */
async function startWatching(repoRoot: string, isCancelled: () => boolean): Promise<boolean> {
  const roots = await watchRootsOf(repoRoot)
  if (isCancelled()) return false
  const answers = await Promise.all(roots.map((root) => window.electronAPI.fs.watchStart(root)))
  return answers.every((answer) => 'ok' in answer)
}

type Refresh = () => Promise<void>

/** Reads status now, on every change the watch reports, and when a setting changes (the file
 * limit decides what status holds); returns the way to stop. */
function followChanges(repoRoot: string, refresh: Refresh, isCancelled: () => boolean): () => void {
  const readIfVisible = () => {
    if (document.visibilityState !== 'hidden') void refresh()
  }
  const unsubscribe = window.electronAPI.fs.onChanged(readIfVisible)
  const unsubscribeSettings = window.electronAPI.extension.onSettingsChanged(readIfVisible)
  document.addEventListener('visibilitychange', readIfVisible)
  let unwatchedRead: ReturnType<typeof setInterval> | undefined
  // The first read comes after the watch has started: a change made before the read is in it,
  // and one made after has an event. macOS arms a watch a moment after it starts and has no
  // signal for it; a change in that moment is read on the next event, or when the view is shown.
  void startWatching(repoRoot, isCancelled).then((isWatching) => {
    if (isCancelled()) return
    void refresh()
    if (!isWatching) unwatchedRead = setInterval(readIfVisible, UNWATCHED_READ_MS)
  })
  return () => {
    unsubscribe()
    unsubscribeSettings()
    document.removeEventListener('visibilitychange', readIfVisible)
    clearInterval(unwatchedRead)
    void window.electronAPI.fs.watchStop()
  }
}

export function useGitStatus(repoRoot: string | null): void {
  const setStatus = useGitStore((s) => s.setStatus)
  const setDisabled = useGitStore((s) => s.setDisabled)
  const setLoading = useGitStore((s) => s.setLoading)
  useEffect(() => {
    if (!repoRoot) {
      setStatus(null)
      return
    }
    let cancelled = false
    const isCancelled = () => cancelled
    const refresh = statusRefresher(repoRoot, { setStatus, setDisabled, setLoading }, isCancelled)
    setLoading(true)
    const stopFollowing = followChanges(repoRoot, refresh, isCancelled)
    return () => {
      cancelled = true
      stopFollowing()
    }
  }, [repoRoot, setStatus, setDisabled, setLoading])
}
