import React, { useState } from 'react'
import { ChevronDown } from 'lucide-react'
import { Button, Popover, SegmentedControl } from '@terminator/extension-ui'
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

  const label =
    commentVisibility === 'hidden' ? 'View · comments hidden' : changed ? 'View (changed)' : 'View'

  return (
    <div className="vm">
      <Button
        variant="ghost"
        size="sm"
        aria-haspopup="true"
        aria-expanded={open}
        aria-label={label}
        title={commentVisibility === 'hidden' ? label : undefined}
        onClick={() => setOpen((v) => !v)}
      >
        View
        {changed && <span className="vm-dot" aria-hidden="true" />}
        <ChevronDown aria-hidden="true" className="tm-icon-sm" />
      </Button>
      {open && (
        <Popover label="View" onDismiss={() => setOpen(false)} className="vm-popover">
          <div className="vm-group">
            <div className="vm-group-label">
              Comments
              <span className="vm-kbd">c</span>
            </div>
            <SegmentedControl
              label="Comment visibility"
              size="sm"
              options={[
                { value: 'all', label: 'All' },
                { value: 'unresolved', label: 'Unresolved' },
                { value: 'hidden', label: 'Hidden' },
              ]}
              value={commentVisibility}
              onChange={setCommentVisibility}
            />
          </div>

          <div className="vm-group">
            <div className="vm-group-label">
              Agent notes
              <span className="vm-kbd">⇧C</span>
            </div>
            <SegmentedControl
              label="Agent notes"
              size="sm"
              options={[
                { value: 'on', label: 'On' },
                { value: 'off', label: 'Off' },
              ]}
              value={agentNotesOn ? 'on' : 'off'}
              onChange={(value) => setAgentNotesOn(value === 'on')}
            />
          </div>

          <div className="vm-group">
            <div className="vm-group-label">Layout</div>
            <SegmentedControl
              label="Diff view mode"
              size="sm"
              options={[
                { value: 'unified', label: 'Unified' },
                { value: 'split', label: 'Split' },
              ]}
              value={diffViewMode}
              onChange={setDiffViewMode}
            />
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
