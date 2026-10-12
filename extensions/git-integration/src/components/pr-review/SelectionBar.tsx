import React from 'react'
import { Button } from '@terminator/extension-ui'

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
      <Button variant="primary" size="sm" onClick={onAskAgent}>
        Ask agent <kbd className="tmui-kbd">a</kbd>
      </Button>
      <Button size="sm" onClick={onExplain}>
        Explain
      </Button>
      <Button size="sm" onClick={onAddNote}>
        Add note <kbd className="tmui-kbd">m</kbd>
      </Button>
      {canComment && (
        <Button size="sm" onClick={onComment}>
          Comment <kbd className="tmui-kbd">r</kbd>
        </Button>
      )}
      <Button size="sm" onClick={onTests}>
        Tests
      </Button>
    </div>
  )
}
