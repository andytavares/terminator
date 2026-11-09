import React from 'react'
import { ChevronLeft, CircleHelp } from 'lucide-react'
import { Button, IconButton } from '@terminator/extension-ui'
import './review-footer.css'
import './review-layout.css'

export interface ReviewFooterProps {
  /** Base names of the neighbouring files in review order; null at either end. */
  previousFileName: string | null
  nextFileName: string | null
  isLastFile: boolean
  isLastChapter: boolean
  /** Where the open file sits, e.g. "Core · file 2 of 4 · chapter 1 of 3". */
  position: string
  isViewed: boolean
  onToggleViewed: (viewed: boolean) => void
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

/** The open file's Viewed box: marks it viewed or not without leaving it. */
function ViewedToggle(props: { isViewed: boolean; onToggleViewed: (viewed: boolean) => void }) {
  return (
    <label className="rf-viewed">
      <input
        type="checkbox"
        aria-label="Viewed"
        checked={props.isViewed}
        onChange={() => props.onToggleViewed(!props.isViewed)}
      />
      <span aria-hidden="true">Viewed</span>
      <kbd className="tmui-kbd" aria-hidden="true">
        v
      </kbd>
    </label>
  )
}

/** The review's one action bar: shortcuts and position on the left, the file's actions right. */
export function ReviewFooter(props: ReviewFooterProps) {
  return (
    <div className="rf-bar">
      <IconButton icon={CircleHelp} label="Keyboard shortcuts" onClick={props.onOpenShortcuts} />
      <span className="rf-position">{props.position}</span>
      <span className="rf-sp" />
      <ViewedToggle isViewed={props.isViewed} onToggleViewed={props.onToggleViewed} />
      <PreviousButton {...props} />
      <ForwardButton {...props} />
    </div>
  )
}
