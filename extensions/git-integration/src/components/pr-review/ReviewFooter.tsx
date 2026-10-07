import React from 'react'
import { ChevronLeft } from 'lucide-react'
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
      <button type="button" className="rf-btn" onClick={onPause}>
        Pause review
      </button>

      {draftsLabel ? (
        <button type="button" className="rf-btn rf-drafts" onClick={onOpenSubmit}>
          {draftsLabel}
        </button>
      ) : (
        <button type="button" className="rf-hint" onClick={onOpenShortcuts}>
          <kbd className="rf-kbd">?</kbd>
          <span>Shortcuts</span>
        </button>
      )}

      <span className="rf-sp" />

      <button
        type="button"
        className="rf-btn rf-icon"
        onClick={onPrevFile}
        aria-label="Previous file"
      >
        <ChevronLeft aria-hidden="true" />
      </button>

      {isLastFile && isLastChapter ? (
        <button
          type="button"
          className="rf-btn rf-pri"
          onClick={onFinishChapter}
          aria-label="Submit review…"
        >
          Submit review…{' '}
          <kbd className="rf-kbd" aria-hidden="true">
            ⌘↵
          </kbd>
        </button>
      ) : isLastFile ? (
        <button type="button" className="rf-btn rf-pri" onClick={onFinishChapter}>
          Finish chapter ↵
        </button>
      ) : (
        <button
          type="button"
          className="rf-btn rf-pri"
          onClick={onMarkViewed}
          aria-label="Mark viewed, next file"
        >
          <span className="rf-long">Mark viewed, next file</span>
          <span className="rf-short">Next</span>
        </button>
      )}
    </div>
  )
}
