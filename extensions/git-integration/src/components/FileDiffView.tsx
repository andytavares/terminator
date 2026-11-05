import React, { useEffect, useState, useRef } from 'react'
import { FileDiff as FileDiffIcon } from 'lucide-react'
import { Button, DiffView, EmptyState, SegmentedControl } from '@terminator/extension-ui'
import type { FileDiff } from '../schemas/git.schema'
import { choose } from './text'
import { useSplitDrag } from '../hooks/useSplitDrag'
import { extensionOf } from '../utils/syntax'
import { recordUsage } from '@terminator/extension-sdk/renderer'

export { buildSplitRows } from '@terminator/extension-ui'
export type { SplitRow } from '@terminator/extension-ui'

type ViewMode = 'unified' | 'split'

interface FileDiffViewProps {
  diff: FileDiff | null
  isStale?: boolean
  onRefresh?: () => void
  /** What the pane says while no diff is shown. */
  empty: DiffEmptyCase
}

/** Why no diff is shown: still reading, a change to pick, none at all, or the selection failed. */
export type DiffEmptyCase =
  | { kind: 'reading' }
  | { kind: 'pick'; onOpenFirstChange: () => void }
  | { kind: 'clean' | 'unreadable'; onRefreshStatus: () => void }

/** What a diff on screen needs: the empty-state actions belong to the empty case only. */
type ShownDiffProps = Pick<FileDiffViewProps, 'isStale' | 'onRefresh'> & { diff: FileDiff }

// ── FileDiffView ──────────────────────────────────────────────────────────────

/** The split divider, measured against the diff's scroll area. */
function useDiffDivider() {
  const scrollRef = useRef<HTMLDivElement>(null)
  const { splitLeftPct, onDividerMouseDown } = useSplitDrag(scrollRef)
  return { splitLeftPct, scrollRef, onDividerMouseDown }
}

const LAYOUT_OPTIONS = [
  { value: 'unified', label: 'Unified' },
  { value: 'split', label: 'Split' },
] as const

function fileTitle(diff: FileDiff): string {
  if (diff.oldPath) return `${diff.oldPath} → ${diff.path}`
  return diff.path
}

function DiffToolbar(props: {
  diff: FileDiff
  viewMode: ViewMode
  setViewMode: (m: ViewMode) => void
}) {
  return (
    <div className="file-diff-view__toolbar">
      <span className="file-diff-view__filename">{fileTitle(props.diff)}</span>
      <SegmentedControl
        label="Diff layout"
        size="sm"
        options={[...LAYOUT_OPTIONS]}
        value={props.viewMode}
        onChange={props.setViewMode}
      />
    </div>
  )
}

function DiffNotices({ props }: { props: ShownDiffProps }) {
  return (
    <>
      {props.isStale && (
        <div className="file-diff-view__stale-banner">
          File changed while viewing.{' '}
          {props.onRefresh && (
            <Button size="sm" onClick={props.onRefresh}>
              Refresh
            </Button>
          )}
        </div>
      )}
      {props.diff.truncated && (
        <div className="file-diff-view__truncation-notice">Diff truncated at 500 KB.</div>
      )}
    </>
  )
}

type SplitDivider = ReturnType<typeof useDiffDivider>

interface ViewState {
  viewMode: ViewMode
  setViewMode: (m: ViewMode) => void
  divider: SplitDivider
}

function FileDiffBody({ diff, view }: { diff: FileDiff; view: ViewState }) {
  const { splitLeftPct, scrollRef, onDividerMouseDown } = view.divider
  const { viewMode } = view
  const lang = extensionOf(diff.path)
  const splitStyle = { '--split-left': `${splitLeftPct}%` } as React.CSSProperties
  return (
    <div
      className="file-diff-view__scroll"
      ref={scrollRef}
      style={choose(viewMode === 'split', splitStyle, undefined)}
    >
      <DiffView
        hunks={diff.hunks}
        language={lang}
        layout={viewMode}
        onDividerMouseDown={onDividerMouseDown}
      />
    </div>
  )
}

function LoadedDiff(props: ShownDiffProps & { view: ViewState }) {
  const { view } = props
  return (
    <div className="file-diff-view">
      <DiffToolbar diff={props.diff} viewMode={view.viewMode} setViewMode={view.setViewMode} />
      <DiffNotices props={props} />
      <FileDiffBody diff={props.diff} view={view} />
    </div>
  )
}

const EMPTY_TEXT = {
  pick: ['No file selected', 'Pick a changed file on the right to see what changed in it.'],
  clean: ['No changes', 'Edit a file in this branch and it shows here.'],
  unreadable: [
    "This file's changes cannot be shown",
    'It may have changed since the list was read. Refresh to read it again.',
  ],
} as const

/** What the pane says while no diff is shown. */
function NoDiff({ empty }: { empty: DiffEmptyCase }): React.JSX.Element {
  if (empty.kind === 'reading') {
    return <div className="file-diff-view file-diff-view--empty">Reading changes…</div>
  }
  const [heading, description] = EMPTY_TEXT[empty.kind]
  const action =
    empty.kind === 'pick'
      ? { label: 'Open the first change', onSelect: empty.onOpenFirstChange }
      : { label: 'Refresh', onSelect: empty.onRefreshStatus }
  return (
    <div className="file-diff-view file-diff-view--empty">
      <EmptyState
        icon={FileDiffIcon}
        heading={heading}
        description={description}
        actions={[action]}
      />
    </div>
  )
}

export function FileDiffView(props: FileDiffViewProps): React.JSX.Element {
  const { diff } = props
  // The layout and divider position outlive the file shown, so they stay as files change.
  const [viewMode, setViewMode] = useState<ViewMode>('unified')
  const divider = useDiffDivider()
  const shownPath = diff?.path
  useEffect(() => {
    if (shownPath) recordUsage('diff-open')
  }, [shownPath])
  if (!diff) {
    return <NoDiff empty={props.empty} />
  }
  if (diff.isBinary) {
    return (
      <div className="file-diff-view file-diff-view--binary">Binary file — no diff available.</div>
    )
  }
  const view = { viewMode, setViewMode, divider }
  return <LoadedDiff diff={diff} isStale={props.isStale} onRefresh={props.onRefresh} view={view} />
}
