import React from 'react'

interface Props {
  onAskAgent: () => void
  onExplain: () => void
  onAddNote: () => void
  onComment: () => void
  onTests: () => void
  /** False when the selection includes lines outside the diff, which GitHub cannot comment on. */
  canComment?: boolean
}

/** The float bar shown under the last selected line (R5 step 1). */
export function SelectionBar({
  onAskAgent,
  onExplain,
  onAddNote,
  onComment,
  onTests,
  canComment = true,
}: Props) {
  return (
    <div className="rs-float" onClick={(e) => e.stopPropagation()}>
      <button type="button" className="rs-btn rs-btn--ag" onClick={onAskAgent}>
        Ask agent <span className="rs-kbd">a</span>
      </button>
      <button type="button" className="rs-btn" onClick={onExplain}>
        Explain
      </button>
      <button type="button" className="rs-btn" onClick={onAddNote}>
        Add note <span className="rs-kbd">m</span>
      </button>
      {canComment && (
        <button type="button" className="rs-btn" onClick={onComment}>
          Comment <span className="rs-kbd">r</span>
        </button>
      )}
      <button type="button" className="rs-btn" onClick={onTests}>
        Tests
      </button>
    </div>
  )
}
