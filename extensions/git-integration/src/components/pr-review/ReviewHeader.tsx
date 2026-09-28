import React, { useState } from 'react'
import { Sparkles, TriangleAlert, MoreHorizontal, X } from 'lucide-react'
import { Popover } from '@terminator/extension-ui'
import { StatusChecksBar } from './StatusChecksBar'
import type { StatusCheck } from '../../schemas/pr-review.schema'
import './review-header.css'

export interface ReviewHeaderProps {
  prNumber: number
  title: string
  isDraft: boolean
  checks: StatusCheck[]
  viewedCount: number
  totalFiles: number
  estimatedMinutes: number
  largePr: { loc: number; minutes: number } | null
  onDismissLargePr: () => void
  focusMode: boolean
  onToggleFocusMode: () => void
  onAskAgent: () => void
  onShowOverview?: () => void
  onPopOut?: () => void
  onRefresh: () => void
  refreshing: boolean
  onToggleFileList: () => void
  onOpenKeyboardHelp: () => void
  onClose: () => void
}

type PillState = StatusCheck['state']

/**
 * One 44px row replacing the old top bar, StatusChecksBar band, progress
 * track and large-PR banner — everything that isn't the diff itself lives
 * here now (design: docs/research/review-screen-declutter.md).
 */
export function ReviewHeader(props: ReviewHeaderProps): JSX.Element {
  const {
    prNumber,
    title,
    isDraft,
    checks,
    viewedCount,
    totalFiles,
    estimatedMinutes,
    largePr,
    onDismissLargePr,
    focusMode,
    onToggleFocusMode,
    onAskAgent,
    onShowOverview,
    onPopOut,
    onRefresh,
    refreshing,
    onToggleFileList,
    onOpenKeyboardHelp,
    onClose,
  } = props

  const [checksOpen, setChecksOpen] = useState(false)
  const [largePrOpen, setLargePrOpen] = useState(false)
  const [menuOpen, setMenuOpen] = useState(false)

  const failCount = checks.filter((c) => c.state === 'fail').length
  const pendingCount = checks.filter((c) => c.state === 'pending').length
  const checksTone: PillState = failCount > 0 ? 'fail' : pendingCount > 0 ? 'pending' : 'pass'
  const checksLabel =
    failCount > 0
      ? `${failCount} of ${checks.length} checks failing`
      : pendingCount > 0
        ? `${pendingCount} of ${checks.length} checks pending`
        : `${checks.length} check${checks.length === 1 ? '' : 's'} passing`

  return (
    <div className="rh-row">
      <span className="rh-num">#{prNumber}</span>
      {isDraft && <span className="rh-draft-badge">Draft</span>}
      <span className="rh-title">{title}</span>

      {checks.length > 0 && (
        <div className="rh-pill-wrap">
          <button
            type="button"
            className={`rh-pill rh-pill--${checksTone}`}
            onClick={() => setChecksOpen((v) => !v)}
            aria-expanded={checksOpen}
          >
            {checksLabel}
          </button>
          {checksOpen && (
            <Popover
              label="Status checks"
              className="rh-popover"
              onDismiss={() => setChecksOpen(false)}
            >
              <StatusChecksBar checks={checks} defaultExpanded />
            </Popover>
          )}
        </div>
      )}

      {largePr && (
        <div className="rh-pill-wrap">
          <button
            type="button"
            className="rh-pill rh-pill--warning"
            onClick={() => setLargePrOpen((v) => !v)}
            aria-expanded={largePrOpen}
          >
            <TriangleAlert aria-hidden="true" className="rh-icon" />
            {largePr.loc.toLocaleString()} LOC · ~{largePr.minutes} min
          </button>
          {largePrOpen && (
            <Popover
              label="Large PR warning"
              className="rh-popover"
              onDismiss={() => setLargePrOpen(false)}
            >
              <p className="rh-large-pr-text">
                Large PR — {largePr.loc.toLocaleString()} LOC, estimated {largePr.minutes} min to
                review. Consider requesting it be split.
              </p>
              <button type="button" className="rh-popover-btn" onClick={onDismissLargePr}>
                Dismiss
              </button>
            </Popover>
          )}
        </div>
      )}

      {focusMode && (
        <button
          type="button"
          className="rh-pill rh-pill--focus"
          aria-pressed={focusMode}
          onClick={onToggleFocusMode}
        >
          Focus mode
        </button>
      )}

      <div className="rh-spacer" />

      <div className="rh-progress">
        <div
          className="rh-progress-meter"
          role="progressbar"
          aria-valuenow={viewedCount}
          aria-valuemin={0}
          aria-valuemax={totalFiles}
          aria-label={`${viewedCount} of ${totalFiles} files viewed`}
        >
          <div
            className="rh-progress-fill"
            style={{ width: `${totalFiles > 0 ? (viewedCount / totalFiles) * 100 : 0}%` }}
          />
        </div>
        <span className="rh-progress-text">
          {viewedCount}/{totalFiles} viewed · ~{estimatedMinutes}m
        </span>
      </div>

      <button
        type="button"
        className="rh-btn rh-btn--ask"
        aria-label="Ask agent about this PR"
        onClick={onAskAgent}
      >
        <Sparkles aria-hidden="true" className="rh-icon" /> Ask agent
      </button>

      <div className="rh-pill-wrap">
        <button
          type="button"
          className="rh-icon-btn"
          aria-label="More review actions"
          aria-haspopup="menu"
          aria-expanded={menuOpen}
          onClick={() => setMenuOpen((v) => !v)}
        >
          <MoreHorizontal aria-hidden="true" className="rh-icon" />
        </button>
        {menuOpen && (
          <Popover
            label="Review actions"
            className="rh-popover"
            onDismiss={() => setMenuOpen(false)}
          >
            <div role="menu" className="rh-menu">
              <button
                type="button"
                role="menuitem"
                className="rh-menu-item"
                onClick={() => {
                  onToggleFocusMode()
                  setMenuOpen(false)
                }}
              >
                <span>Focus mode</span>
                {focusMode && <span className="rh-menu-hint">On</span>}
              </button>
              {onShowOverview && (
                <button
                  type="button"
                  role="menuitem"
                  className="rh-menu-item"
                  onClick={() => {
                    onShowOverview()
                    setMenuOpen(false)
                  }}
                >
                  <span>Overview</span>
                  <span className="rh-menu-hint">i</span>
                </button>
              )}
              <button
                type="button"
                role="menuitem"
                className="rh-menu-item"
                onClick={() => {
                  onToggleFileList()
                  setMenuOpen(false)
                }}
              >
                <span>Hide file list</span>
                <span className="rh-menu-hint">t</span>
              </button>
              <button
                type="button"
                role="menuitem"
                className="rh-menu-item"
                disabled={refreshing}
                onClick={() => {
                  onRefresh()
                  setMenuOpen(false)
                }}
              >
                <span>Refresh PR</span>
              </button>
              {onPopOut && (
                <button
                  type="button"
                  role="menuitem"
                  className="rh-menu-item"
                  onClick={() => {
                    onPopOut()
                    setMenuOpen(false)
                  }}
                >
                  <span>Pop out</span>
                </button>
              )}
              <button
                type="button"
                role="menuitem"
                className="rh-menu-item"
                onClick={() => {
                  onOpenKeyboardHelp()
                  setMenuOpen(false)
                }}
              >
                <span>Keyboard shortcuts</span>
                <span className="rh-menu-hint">?</span>
              </button>
            </div>
          </Popover>
        )}
      </div>

      <button type="button" className="rh-icon-btn" aria-label="Close review" onClick={onClose}>
        <X aria-hidden="true" className="rh-icon" />
      </button>
    </div>
  )
}
