import React, { useState } from 'react'
import { Layers, Trash2 } from 'lucide-react'
import type { HunkFold, SameShapeFold } from '../../review/diff-items'

interface Props {
  fold: HunkFold
  expanded: boolean
  onToggleShow: () => void
  onGoToFirst: (path: string) => void
}

/** The literals this hunk changes next to the ones the first hunk changes. */
function Differences({ fold }: { fold: SameShapeFold }) {
  const { first } = fold
  return (
    <span className="rs-fold-diff">
      <span>
        This hunk <code>{fold.maskedValues.join(' → ')}</code>
      </span>
      <span>
        {first.path}:{first.line} <code>{first.maskedValues.join(' → ')}</code>
      </span>
    </span>
  )
}

function SameShapeText(props: { fold: SameShapeFold; onGoToFirst: Props['onGoToFirst'] }) {
  const { first } = props.fold
  return (
    <>
      <Layers aria-hidden="true" />
      <span>
        Same change as{' '}
        <button type="button" className="rs-link" onClick={() => props.onGoToFirst(first.path)}>
          {first.path}:{first.line}
        </button>
      </span>
    </>
  )
}

/** The literal differences of an opened same-shape fold, behind their own toggle. */
function DifferencesToggle({ fold }: { fold: SameShapeFold }) {
  const [shown, setShown] = useState(false)
  if (fold.maskedValues.length === 0) return null
  return (
    <>
      <button type="button" className="rs-btn" onClick={() => setShown(!shown)}>
        {shown ? 'Hide differences' : 'Show differences'}
      </button>
      {shown && <Differences fold={fold} />}
    </>
  )
}

/** One row standing in for a hunk that repeats another hunk's change or only deletes lines. */
export function FoldRow(props: Props) {
  const { fold, expanded } = props
  return (
    <div className="rs-moved rs-fold" role="group" aria-label="Folded hunk">
      {fold.kind === 'same-shape' && <SameShapeText fold={fold} onGoToFirst={props.onGoToFirst} />}
      {fold.kind === 'deleted' && (
        <>
          <Trash2 aria-hidden="true" />
          <span>{fold.lineCount} lines deleted</span>
        </>
      )}
      {' · '}
      <button type="button" className="rs-btn" onClick={props.onToggleShow}>
        {expanded ? 'Hide' : 'Show'}
      </button>
      {expanded && fold.kind === 'same-shape' && <DifferencesToggle fold={fold} />}
    </div>
  )
}
