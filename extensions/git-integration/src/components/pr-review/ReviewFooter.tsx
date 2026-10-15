import React from 'react'
import { ChevronLeft } from 'lucide-react'
import { Button } from '@terminator/extension-ui'
import './review-footer.css'
import './review-layout.css'

export interface ReviewFooterProps {
  /** Base names of the neighbouring files in review order; null at either end. */
  previousFileName: string | null
  nextFileName: string | null
  isLastFile: boolean
  isLastChapter: boolean
  onPrevFile: () => void
  onMarkViewed: () => void
  onFinishChapter: () => void
  onOpenShortcuts: () => void
}

function PreviousButton(props: ReviewFooterProps) {
  return (
    <Button
      variant="ghost"
      icon={ChevronLeft}
      disabled={props.previousFileName === null}
      onClick={props.onPrevFile}
    >
      <span className="pr-visually-hidden">Previous file: {props.previousFileName}</span>
      <span className="rf-name rf-collapsible" aria-hidden="true">
        {props.previousFileName}
      </span>
    </Button>
  )
}

/** The forward action: mark viewed and go on, finish the chapter, or submit at the very end. */
function ForwardButton(props: ReviewFooterProps) {
  const { isLastFile, isLastChapter, nextFileName } = props
  if (!isLastFile) {
    if (nextFileName === null) {
      return <ForwardLabel onClick={props.onMarkViewed}>Viewed, next file</ForwardLabel>
    }
    return (
      <ForwardLabel onClick={props.onMarkViewed}>
        Viewed, next: <span className="rf-name">{nextFileName}</span>
      </ForwardLabel>
    )
  }
  const label = isLastChapter ? 'Viewed, submit review' : 'Viewed, next chapter'
  return <ForwardLabel onClick={props.onFinishChapter}>{label}</ForwardLabel>
}

function ForwardLabel(props: { onClick: () => void; children: React.ReactNode }) {
  return (
    <Button variant="primary" onClick={props.onClick}>
      <span className="rf-long">{props.children}</span>
      <span className="rf-short">Next</span>
      <kbd className="tmui-kbd" aria-hidden="true">
        ↵
      </kbd>
    </Button>
  )
}

export function ReviewFooter(props: ReviewFooterProps) {
  return (
    <div className="rf-bar">
      <Button variant="ghost" onClick={props.onOpenShortcuts}>
        <kbd className="tmui-kbd">?</kbd>
        <span>Shortcuts</span>
      </Button>
      <span className="rf-sp" />
      <PreviousButton {...props} />
      <ForwardButton {...props} />
    </div>
  )
}
