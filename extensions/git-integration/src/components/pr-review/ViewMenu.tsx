import React, { useState } from 'react'
import { ChevronDown } from 'lucide-react'
import { Popover } from '@terminator/extension-ui'
import { useReviewUiStore } from '../../stores/review-ui.store'
import './view-menu.css'

export interface ViewMenuProps {
  /** Muted text shown at the bottom of the menu, e.g. "Showing a1b2… head". */
  sinceNote?: string | null
}

/** File-header menu: comments, agent notes, diff layout and the formatting filter. */
export function ViewMenu({ sinceNote }: ViewMenuProps) {
  const [open, setOpen] = useState(false)
  const commentVisibility = useReviewUiStore((s) => s.commentVisibility)
  const setCommentVisibility = useReviewUiStore((s) => s.setCommentVisibility)
  const agentNotesOn = useReviewUiStore((s) => s.agentNotesOn)
  const setAgentNotesOn = useReviewUiStore((s) => s.setAgentNotesOn)
  const diffViewMode = useReviewUiStore((s) => s.diffViewMode)
  const setDiffViewMode = useReviewUiStore((s) => s.setDiffViewMode)
  const hideFormattingHunks = useReviewUiStore((s) => s.hideFormattingHunks)
  const setHideFormattingHunks = useReviewUiStore((s) => s.setHideFormattingHunks)

  const changed =
    commentVisibility !== 'all' ||
    !agentNotesOn ||
    diffViewMode !== 'unified' ||
    !hideFormattingHunks

  return (
    <div className="vm">
      <button
        type="button"
        className="vm-btn"
        aria-haspopup="true"
        aria-expanded={open}
        aria-label={changed ? 'View (changed)' : 'View'}
        onClick={() => setOpen((v) => !v)}
      >
        View
        {changed && <span className="vm-dot" aria-hidden="true" />}
        <ChevronDown aria-hidden="true" className="tm-icon-sm" />
      </button>
      {commentVisibility === 'hidden' && <span className="vm-note">Comments hidden</span>}
      {open && (
        <Popover label="View" onDismiss={() => setOpen(false)} className="vm-popover">
          <div className="vm-group">
            <div className="vm-group-label">
              Comments
              <span className="vm-kbd">c</span>
            </div>
            <div className="vm-seg" role="group" aria-label="Comment visibility">
              <button
                type="button"
                aria-pressed={commentVisibility === 'all'}
                onClick={() => setCommentVisibility('all')}
              >
                All
              </button>
              <button
                type="button"
                aria-pressed={commentVisibility === 'unresolved'}
                onClick={() => setCommentVisibility('unresolved')}
              >
                Unresolved
              </button>
              <button
                type="button"
                aria-pressed={commentVisibility === 'hidden'}
                onClick={() => setCommentVisibility('hidden')}
              >
                Hidden
              </button>
            </div>
          </div>

          <div className="vm-group">
            <div className="vm-group-label">
              Agent notes
              <span className="vm-kbd">⇧C</span>
            </div>
            <div className="vm-seg" role="group" aria-label="Agent notes">
              <button
                type="button"
                aria-pressed={agentNotesOn}
                onClick={() => setAgentNotesOn(true)}
              >
                On
              </button>
              <button
                type="button"
                aria-pressed={!agentNotesOn}
                onClick={() => setAgentNotesOn(false)}
              >
                Off
              </button>
            </div>
          </div>

          <div className="vm-group">
            <div className="vm-group-label">Layout</div>
            <div className="vm-seg" role="group" aria-label="Diff view mode">
              <button
                type="button"
                aria-pressed={diffViewMode === 'unified'}
                onClick={() => setDiffViewMode('unified')}
              >
                Unified
              </button>
              <button
                type="button"
                aria-pressed={diffViewMode === 'split'}
                onClick={() => setDiffViewMode('split')}
              >
                Split
              </button>
            </div>
          </div>

          <button
            type="button"
            role="switch"
            aria-checked={hideFormattingHunks}
            className="vm-switch-row"
            onClick={() => setHideFormattingHunks(!hideFormattingHunks)}
          >
            <span className="vm-switch" aria-hidden="true" />
            Hide formatting-only hunks
          </button>

          {sinceNote && <div className="vm-since">{sinceNote}</div>}
        </Popover>
      )}
    </div>
  )
}
