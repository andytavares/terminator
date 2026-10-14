import React from 'react'
import { ChevronLeft } from 'lucide-react'
import { Button, IconButton } from '@terminator/extension-ui'
import type { DraftComment } from '../../schemas/pr-review.schema'
import './review-footer.css'
import { plural } from '@terminator/extension-sdk'

export interface ReviewFooterProps {
  drafts: DraftComment[]
  isLastFile: boolean
  isLastChapter: boolean
  onPause: () => void
  onPrevFile: () => void
  onMarkViewed: () => void
  onFinishChapter: () => void
  onOpenSubmit: () => void
  onOpenShortcuts: () => void
}

/** "N drafts on M files · K from an agent finding", or null with no drafts. */
function draftsLabelOf(drafts: DraftComment[]): string | null {
  if (drafts.length === 0) return null
  const fileCount = new Set(drafts.map((d) => d.path)).size
  const fromFindingCount = drafts.filter((d) => d.fromFindingId).length
  const fromFinding = fromFindingCount > 0 ? ` · ${fromFindingCount} from an agent finding` : ''
  return `${drafts.length} ${plural(drafts.length, 'draft')} on ${fileCount} ${plural(fileCount, 'file')}${fromFinding}`
}

function SubmitButton({ onClick }: { onClick: () => void }) {
  return (
    <Button variant="primary" size="sm" onClick={onClick} aria-label="Submit review…">
      Submit review…{' '}
      <kbd className="tmui-kbd" aria-hidden="true">
        ⌘↵
      </kbd>
    </Button>
  )
}

function NextFileButton({ onClick }: { onClick: () => void }) {
  return (
    <Button variant="primary" size="sm" onClick={onClick} aria-label="Mark viewed, next file">
      <span className="rf-long">Mark viewed, next file</span>
      <span className="rf-short">Next</span>
    </Button>
  )
}

/** The forward action: mark viewed and go on, finish the chapter, or submit at the very end. */
function ForwardButton(props: ReviewFooterProps) {
  if (!props.isLastFile) return <NextFileButton onClick={props.onMarkViewed} />
  if (props.isLastChapter) return <SubmitButton onClick={props.onFinishChapter} />
  return (
    <Button variant="primary" size="sm" onClick={props.onFinishChapter}>
      Finish chapter <kbd className="tmui-kbd">↵</kbd>
    </Button>
  )
}

export function ReviewFooter(props: ReviewFooterProps) {
  const draftsLabel = draftsLabelOf(props.drafts)
  return (
    <div className="rf-bar">
      <Button size="sm" onClick={props.onPause}>
        Pause review
      </Button>
      {draftsLabel ? (
        <Button size="sm" onClick={props.onOpenSubmit}>
          {draftsLabel}
        </Button>
      ) : (
        <Button variant="ghost" size="sm" onClick={props.onOpenShortcuts}>
          <kbd className="tmui-kbd">?</kbd>
          <span>Shortcuts</span>
        </Button>
      )}
      <span className="rf-sp" />
      <IconButton icon={ChevronLeft} label="Previous file" onClick={props.onPrevFile} />
      <ForwardButton {...props} />
    </div>
  )
}
