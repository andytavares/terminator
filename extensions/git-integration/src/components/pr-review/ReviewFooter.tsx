import React from 'react'
import { ChevronLeft } from 'lucide-react'
import { Button, IconButton } from '@terminator/extension-ui'
import type { DraftComment } from '../../schemas/pr-review.schema'
import './review-footer.css'

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

export function ReviewFooter({
  drafts,
  isLastFile,
  isLastChapter,
  onPause,
  onPrevFile,
  onMarkViewed,
  onFinishChapter,
  onOpenSubmit,
  onOpenShortcuts,
}: ReviewFooterProps) {
  const fileCount = new Set(drafts.map((d) => d.path)).size
  const fromFindingCount = drafts.filter((d) => d.fromFindingId).length

  const draftsLabel =
    drafts.length > 0
      ? `${drafts.length} draft${drafts.length === 1 ? '' : 's'} on ${fileCount} file${
          fileCount === 1 ? '' : 's'
        }${fromFindingCount > 0 ? ` · ${fromFindingCount} from an agent finding` : ''}`
      : null

  return (
    <div className="rf-bar">
      <Button size="sm" onClick={onPause}>
        Pause review
      </Button>

      {draftsLabel ? (
        <Button size="sm" onClick={onOpenSubmit}>
          {draftsLabel}
        </Button>
      ) : (
        <Button variant="ghost" size="sm" onClick={onOpenShortcuts}>
          <kbd className="tmui-kbd">?</kbd>
          <span>Shortcuts</span>
        </Button>
      )}

      <span className="rf-sp" />

      <IconButton icon={ChevronLeft} label="Previous file" onClick={onPrevFile} />

      {isLastFile && isLastChapter ? (
        <Button variant="primary" size="sm" onClick={onFinishChapter} aria-label="Submit review…">
          Submit review…{' '}
          <kbd className="tmui-kbd" aria-hidden="true">
            ⌘↵
          </kbd>
        </Button>
      ) : isLastFile ? (
        <Button variant="primary" size="sm" onClick={onFinishChapter}>
          Finish chapter <kbd className="tmui-kbd">↵</kbd>
        </Button>
      ) : (
        <Button
          variant="primary"
          size="sm"
          onClick={onMarkViewed}
          aria-label="Mark viewed, next file"
        >
          <span className="rf-long">Mark viewed, next file</span>
          <span className="rf-short">Next</span>
        </Button>
      )}
    </div>
  )
}
