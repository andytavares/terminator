import React from 'react'
import { Button } from '@terminator/extension-ui'

interface Props {
  onComment: () => void
  onAskAgent: () => void
  onExplain: () => void
  /** False when the selection includes lines outside the diff, which GitHub cannot comment on. */
  canComment?: boolean
}

/** The float bar shown under the last selected line (R5 step 1). */
export function SelectionBar(props: Props) {
  const canComment = props.canComment ?? true
  return (
    <div className="rs-float" onClick={(e) => e.stopPropagation()}>
      {canComment && (
        <Button size="sm" onClick={props.onComment}>
          Comment <kbd className="tmui-kbd">c</kbd>
        </Button>
      )}
      <Button variant="primary" size="sm" onClick={props.onAskAgent}>
        Ask agent
      </Button>
      <Button size="sm" onClick={props.onExplain}>
        Explain
      </Button>
    </div>
  )
}
