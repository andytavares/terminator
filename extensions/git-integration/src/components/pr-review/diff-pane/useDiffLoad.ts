import { useEffect, useState } from 'react'
import { githubAPI } from '../../../api/github'
import { parseDiff } from '../../../github/pr-review-service'
import { FileDiffSchema, type FileDiff } from '../../../schemas/git.schema'

interface CachedDiff {
  diff: FileDiff
  note: string | null
}

/** What to fetch: the file's whole diff, or only what changed since `sinceSha`. */
export interface DiffRequest {
  diffKey: string
  repoRoot: string
  prNumber: number
  headSHA: string
  baseRefName: string
  path: string
  sinceSha: string | undefined
}

interface LoadCallbacks {
  isCancelled: () => boolean
  show: (diff: FileDiff, note: string | null) => void
  fail: (message: string) => void
  markRewritten: () => void
}

type CompareAnswer = Awaited<ReturnType<typeof githubAPI.prCompare>>

interface DiffStore {
  setDiffCache: (update: (prev: Map<string, CachedDiff>) => Map<string, CachedDiff>) => void
  setDiffFailure: (
    update: (
      prev: { key: string; message: string } | null
    ) => { key: string; message: string } | null
  ) => void
  setRewrittenNoteFor: (key: string) => void
}

type Failure = { key: string; message: string } | null

export const REWRITTEN_NOTE = 'History rewritten — showing the whole file'
const DIFF_CACHE_CAP = 60

/** The cache with `entry` as its newest; the oldest goes once there are more than 60. */
function rememberDiff(
  cache: Map<string, CachedDiff>,
  key: string,
  entry: CachedDiff
): Map<string, CachedDiff> {
  const next = new Map(cache)
  next.delete(key)
  next.set(key, entry)
  if (next.size > DIFF_CACHE_CAP) next.delete(next.keys().next().value as string)
  return next
}

/** The file's diff against the base. */
async function loadFullDiff(req: DiffRequest, cb: LoadCallbacks, note: string | null) {
  try {
    const result = await githubAPI.prFileDiff({
      repoRoot: req.repoRoot,
      prNumber: req.prNumber,
      path: req.path,
      baseRef: req.baseRefName,
      headSHA: req.headSHA,
    })
    if (cb.isCancelled()) return
    if ('error' in result) return cb.fail(result.error)
    const parsed = FileDiffSchema.safeParse(result.diff)
    if (parsed.success) cb.show(parsed.data, note)
    else cb.fail('Unexpected diff format from server')
  } catch (e) {
    cb.fail(String(e))
  }
}

/**
 * Shows the file's part of the comparison; otherwise says which note the whole diff, shown
 * instead, carries: the rewritten-history note when the history was rewritten.
 */
function showComparison(cmp: CompareAnswer, req: DiffRequest, cb: LoadCallbacks) {
  if ('error' in cmp) return { fallbackNote: null }
  if (cmp.rewritten) {
    cb.markRewritten()
    return { fallbackNote: REWRITTEN_NOTE }
  }
  const entry = cmp.files.find((f) => f.path === req.path)
  if (!entry) return { fallbackNote: null }
  cb.show(parseDiff(entry.patch, req.path), `Showing ${req.sinceSha!.slice(0, 8)} … head`)
  return null
}

/** The comparison's outcome: shown, or the note the whole diff shown instead carries. */
async function compareSince(req: DiffRequest, cb: LoadCallbacks) {
  try {
    const cmp = await githubAPI.prCompare(req.repoRoot, req.sinceSha!, req.headSHA)
    if (cb.isCancelled()) return null
    return showComparison(cmp, req, cb)
  } catch {
    return { fallbackNote: null }
  }
}

/** What changed since the reviewer last viewed the file, falling back to the whole diff. */
async function loadSinceDiff(req: DiffRequest, cb: LoadCallbacks) {
  const fallback = await compareSince(req, cb)
  if (fallback) await loadFullDiff(req, cb, fallback.fallbackNote)
}

/** Callbacks writing a load's outcome into the pane's state, unless the load was cancelled. */
function loadCallbacks(
  diffKey: string,
  store: DiffStore,
  isCancelled: () => boolean
): LoadCallbacks {
  return {
    isCancelled,
    show: (diff, note) => store.setDiffCache((prev) => rememberDiff(prev, diffKey, { diff, note })),
    fail: (message) => {
      if (!isCancelled()) store.setDiffFailure(() => ({ key: diffKey, message }))
    },
    markRewritten: () => store.setRewrittenNoteFor(diffKey),
  }
}

/** Fetches the diff for `req` unless it is cached or binary; a newer request cancels an older. */
function useDiffFetch(req: DiffRequest, skip: boolean, store: DiffStore) {
  const { diffKey, repoRoot, prNumber, headSHA, baseRefName, path, sinceSha } = req
  useEffect(() => {
    if (skip) return
    let cancelled = false
    const request = { diffKey, repoRoot, prNumber, headSHA, baseRefName, path, sinceSha }
    const cb = loadCallbacks(diffKey, store, () => cancelled)
    if (sinceSha) void loadSinceDiff(request, cb)
    else void loadFullDiff(request, cb, null)
    return () => {
      cancelled = true
      store.setDiffFailure((failure) => withoutFailureFor(failure, diffKey))
    }
    // The store's setters are stable; the object holding them is new each render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [diffKey, path, skip, repoRoot, prNumber, headSHA, baseRefName, sinceSha])
}

/** The failure, unless it is the one for `key`, which a new load clears. */
function withoutFailureFor(failure: Failure, key: string): Failure {
  if (failure?.key === key) return null
  return failure
}

/** The load error to show: only one for this key, and only while nothing is cached for it. */
function failureFor(failure: Failure, cached: CachedDiff | undefined, key: string): string | null {
  if (cached || failure?.key !== key) return null
  return failure.message
}

function sinceNoteOf(cached: CachedDiff | undefined, rewrittenFor: string | null, diffKey: string) {
  if (cached) return cached.note
  if (rewrittenFor === diffKey) return REWRITTEN_NOTE
  return null
}

/**
 * The file's diff for the current range, cached per key: the diff once loaded, the error
 * when it failed, the note to show beside it, and whether it is still loading.
 */
export function useDiffLoad(req: DiffRequest, isBinary: boolean) {
  const [diffCache, setDiffCache] = useState<Map<string, CachedDiff>>(() => new Map())
  const [diffFailure, setDiffFailure] = useState<{ key: string; message: string } | null>(null)
  const [rewrittenNoteFor, setRewrittenNoteFor] = useState<string | null>(null)
  const { diffKey } = req
  const cachedDiff = isBinary ? undefined : diffCache.get(diffKey)
  useDiffFetch(req, isBinary || cachedDiff !== undefined, {
    setDiffCache,
    setDiffFailure,
    setRewrittenNoteFor,
  })
  const diffError = failureFor(diffFailure, cachedDiff, diffKey)
  return {
    diff: cachedDiff?.diff ?? null,
    diffError,
    sinceNote: sinceNoteOf(cachedDiff, rewrittenNoteFor, diffKey),
    diffLoading: !isBinary && !cachedDiff && !diffError,
  }
}
