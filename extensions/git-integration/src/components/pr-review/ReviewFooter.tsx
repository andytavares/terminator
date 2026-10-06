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
        <span className="rf-hint">
          <span className="rf-hint-group rf-hint-group--nav">
            <kbd className="rf-kbd">[</kbd>
            <kbd className="rf-kbd">]</kbd>
            <span>files</span>
          </span>
          <span className="rf-hint-group rf-hint-group--nav">
            <kbd className="rf-kbd">j</kbd>
            <kbd className="rf-kbd">k</kbd>
            <span>hunks</span>
          </span>
          <span className="rf-hint-group rf-hint-group--nav">
            <kbd className="rf-kbd">v</kbd>
            <span>viewed</span>
          </span>
          <span className="rf-hint-group">
            <kbd className="rf-kbd">?</kbd>
            <span>all keys</span>
          </span>
        </span>
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

      {isLastFile ? (
        <button type="button" className="rf-btn rf-pri" onClick={onFinishChapter}>
          {isLastChapter ? 'Finish review ↵' : 'Finish chapter ↵'}
        </button>
      ) : (
        <button
          type="button"
          className="rf-btn rf-pri"
          onClick={onMarkViewed}
          aria-label="Mark viewed, go to next"
        >
          <span className="rf-long">Mark viewed, go to next</span>
          <span className="rf-short">Next</span>
        </button>
      )}

      <button type="button" className="rf-btn" onClick={onOpenSubmit} aria-label="Submit review">
        Submit review{' '}
        <kbd className="rf-kbd" aria-hidden="true">
          ⌘↵
        </kbd>
      </button>
    </div>
  )
}
