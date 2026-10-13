import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { githubAPI } from '../../../api/github'
import {
  EXPAND_STEP,
  gapsFor,
  reveal,
  splitLines,
  type Expansion,
  type Gap,
} from '../../../review/expand-gaps'
import type { GapView } from '../../../review/diff-items'
import type { FileDiff } from '../../../schemas/git.schema'
import type { LineSelection } from '../../../stores/review-ui.store'
import type { FileText } from './types'
import { inSelection } from './lines'

type ContentResult = { content: string } | { tooLarge: true } | { error: string }

type ExpandKind = 'above' | 'below' | 'all'

/** The file whose text the gaps reveal: the PR head's version. */
export interface TextTarget {
  repoRoot: string
  prNumber: number
  headSHA: string
  path: string
}

interface TextLoad {
  key: string
  cache: Map<string, string[]>
  isCurrent: () => boolean
  setFileText: (text: FileText) => void
}

interface GapSource {
  target: TextTarget
  diff: FileDiff | null
  isBinary: boolean | undefined
  diffKey: string
}

export type GapControl = ReturnType<typeof useGaps>

function textFrom(result: ContentResult): FileText {
  if ('tooLarge' in result) return { status: 'tooLarge' }
  if ('error' in result) return { status: 'error', message: result.error }
  return { status: 'ready', lines: splitLines(result.content) }
}

/** Reads the file at the head, unless it is cached; a load for a file no longer shown is dropped. */
async function readFileText(target: TextTarget, load: TextLoad): Promise<void> {
  const cached = load.cache.get(load.key)
  if (cached) return load.setFileText({ status: 'ready', lines: cached })
  load.setFileText({ status: 'loading' })
  try {
    const raw = await githubAPI.prFileContent({
      repoRoot: target.repoRoot,
      prNumber: target.prNumber,
      path: target.path,
      ref: target.headSHA,
    })
    if (!load.isCurrent()) return
    const text = textFrom(raw as ContentResult)
    if (text.status === 'ready') load.cache.set(load.key, text.lines)
    load.setFileText(text)
  } catch (e) {
    if (load.isCurrent()) load.setFileText({ status: 'error', message: String(e) })
  }
}

/** The whole file's text, for revealing the unchanged lines between hunks. */
function useHeadText(target: TextTarget) {
  const [fileText, setFileText] = useState<FileText>({ status: 'idle' })
  const cacheRef = useRef(new Map<string, string[]>())
  const fileTextKey = `${target.path}@${target.headSHA}`
  const keyRef = useRef(fileTextKey)
  useEffect(() => {
    keyRef.current = fileTextKey
  })
  const { repoRoot, prNumber, headSHA, path } = target
  const loadFileText = useCallback(() => {
    const key = keyRef.current
    const load = {
      key,
      cache: cacheRef.current,
      isCurrent: () => keyRef.current === key,
      setFileText,
    }
    void readFileText({ repoRoot, prNumber, headSHA, path }, load)
  }, [repoRoot, prNumber, headSHA, path])
  return { fileText, setFileText, loadFileText }
}

/** The expansion after one more click on a gap's button. */
function expanded(cur: Expansion, kind: ExpandKind): Expansion {
  if (kind === 'above') return { ...cur, fromBottom: cur.fromBottom + EXPAND_STEP }
  if (kind === 'below') return { ...cur, fromTop: cur.fromTop + EXPAND_STEP }
  return { fromTop: Number.MAX_SAFE_INTEGER, fromBottom: 0 }
}

/** A gap's lines when the text is read; before that, only how many lines it hides, if known. */
function gapView(gap: Gap, exp: Expansion, fileText: FileText): GapView {
  if (fileText.status === 'ready') return reveal(gap, fileText.lines, exp)
  if (gap.newEnd == null) return { above: [], hidden: null, below: [] }
  const size = gap.newEnd - gap.newStart + 1
  const top = Math.min(exp.fromTop, size)
  const bottom = Math.min(exp.fromBottom, size - top)
  return { above: [], hidden: size - top - bottom, below: [] }
}

function gapViewsFor(gaps: Gap[], expansions: Map<string, Expansion>, fileText: FileText) {
  const views = new Map<string, GapView>()
  for (const gap of gaps) {
    views.set(
      gap.key,
      gapView(gap, expansions.get(gap.key) ?? { fromTop: 0, fromBottom: 0 }, fileText)
    )
  }
  return views
}

/** Gaps come from every hunk, not the visible ones, so hiding formatting hunks never shifts them. */
function gapsOf(diff: FileDiff | null, isBinary: boolean | undefined): Gap[] {
  if (!diff || isBinary || diff.truncated) return []
  return gapsFor(diff.hunks)
}

/** True when the selection takes in a revealed line, which GitHub cannot comment on. */
function touchesRevealed(gapViews: Map<string, GapView>, sel: LineSelection): boolean {
  const revealed = [...gapViews.values()].flatMap((view) => [...view.above, ...view.below])
  return revealed.some((line) => inSelection(line, sel))
}

/**
 * The unchanged lines between hunks: what each gap shows, how to reveal more (reading the
 * file the first time), and whether a selection reaches into revealed lines. All of it starts
 * again when the diff shown changes.
 */
export function useGaps(source: GapSource) {
  const { fileText, setFileText, loadFileText } = useHeadText(source.target)
  const [expansions, setExpansions] = useState<Map<string, Expansion>>(new Map())
  const [shownDiffKey, setShownDiffKey] = useState(source.diffKey)
  if (shownDiffKey !== source.diffKey) {
    setShownDiffKey(source.diffKey)
    setExpansions(new Map())
    setFileText({ status: 'idle' })
  }
  const expandGap = (key: string, kind: ExpandKind) => {
    setExpansions((prev) =>
      new Map(prev).set(key, expanded(prev.get(key) ?? { fromTop: 0, fromBottom: 0 }, kind))
    )
    if (fileText.status === 'idle') loadFileText()
  }
  const gaps = useMemo(() => gapsOf(source.diff, source.isBinary), [source.diff, source.isBinary])
  const gapViews = useMemo(
    () => gapViewsFor(gaps, expansions, fileText),
    [gaps, expansions, fileText]
  )
  const path = source.target.path
  const selectionTouchesRevealed = useCallback(
    (sel: LineSelection | null) => !!sel && sel.path === path && touchesRevealed(gapViews, sel),
    [gapViews, path]
  )
  return { fileText, loadFileText, expandGap, gapViews, selectionTouchesRevealed }
}
