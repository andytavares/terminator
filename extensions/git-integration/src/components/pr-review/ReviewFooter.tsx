import React from 'react'
import { CircleHelp } from 'lucide-react'
import { IconButton } from '@terminator/extension-ui'
import './review-footer.css'
import './review-layout.css'

export interface ReviewFooterProps {
  /** Where the reader is, e.g. "Chapter 2 of 5 · 40% read", or "40% read" on one page. */
  position: string
  onOpenShortcuts: () => void
}

/** The bar under the stream: the keyboard sheet and the reader's position. */
export function ReviewFooter(props: ReviewFooterProps) {
  return (
    <div className="rf-bar">
      <IconButton icon={CircleHelp} label="Keyboard shortcuts" onClick={props.onOpenShortcuts} />
      <span className="rf-position">{props.position}</span>
    </div>
  )
}
