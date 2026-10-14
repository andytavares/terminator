import React, { useState } from 'react'
import { Sparkles, TriangleAlert, MoreHorizontal, X } from 'lucide-react'
import { Button, IconButton, Popover } from '@terminator/extension-ui'
import { StatusChecksBar } from './StatusChecksBar'
import type { StatusCheck } from '../../schemas/pr-review.schema'
import { plural } from '@terminator/extension-sdk'
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

function checksTone(checks: StatusCheck[]): PillState {
  if (checks.some((c) => c.state === 'fail')) return 'fail'
  if (checks.some((c) => c.state === 'pending')) return 'pending'
  return 'pass'
}

/** "2 of 8 checks failing", "1 of 8 checks pending", or "8 checks passing". */
function checksLabel(checks: StatusCheck[]): string {
  const failCount = checks.filter((c) => c.state === 'fail').length
  const pendingCount = checks.filter((c) => c.state === 'pending').length
  if (failCount > 0) return `${failCount} of ${checks.length} checks failing`
  if (pendingCount > 0) return `${pendingCount} of ${checks.length} checks pending`
  return `${checks.length} ${plural(checks.length, 'check')} passing`
}

/** A pill that opens a popover under itself. */
function PillPopover(props: {
  pillClass: string
  pill: React.ReactNode
  label: string
  children: React.ReactNode
}) {
  const [open, setOpen] = useState(false)
  return (
    <div className="rh-pill-wrap">
      <button
        aria-expanded={open}
        type="button"
        className={props.pillClass}
        onClick={() => setOpen((v) => !v)}
      >
        {props.pill}
      </button>
      {open && (
        <Popover label={props.label} className="rh-popover" onDismiss={() => setOpen(false)}>
          {props.children}
        </Popover>
      )}
    </div>
  )
}

function ChecksPill({ checks }: { checks: StatusCheck[] }) {
  return (
    <PillPopover
      pillClass={`rh-pill rh-pill--${checksTone(checks)}`}
      pill={checksLabel(checks)}
      label="Status checks"
    >
      <StatusChecksBar checks={checks} defaultExpanded />
    </PillPopover>
  )
}

function LargePrPill(props: { largePr: { loc: number; minutes: number }; onDismiss: () => void }) {
  const { loc, minutes } = props.largePr
  const pill = (
    <>
      <TriangleAlert aria-hidden="true" className="rh-icon" />
      {loc.toLocaleString()} LOC · ~{minutes} min
    </>
  )
  return (
    <PillPopover pillClass="rh-pill rh-pill--warning" pill={pill} label="Large PR warning">
      <p className="rh-large-pr-text">
        Large PR — {loc.toLocaleString()} LOC, estimated {minutes} min to review. Consider
        requesting it be split.
      </p>
      <Button size="sm" onClick={props.onDismiss}>
        Dismiss
      </Button>
    </PillPopover>
  )
}

function progressPercent(viewed: number, total: number): number {
  if (total <= 0) return 0
  return (viewed / total) * 100
}

function ReviewProgress(props: {
  viewedCount: number
  totalFiles: number
  estimatedMinutes: number
}) {
  const { viewedCount, totalFiles } = props
  return (
    <div className="rh-progress">
      <div
        aria-valuenow={viewedCount}
        aria-valuemin={0}
        aria-valuemax={totalFiles}
        aria-label={`${viewedCount} of ${totalFiles} files viewed`}
        className="rh-progress-meter"
        role="progressbar"
      >
        <div
          className="rh-progress-fill"
          style={{ width: `${progressPercent(viewedCount, totalFiles)}%` }}
        />
      </div>
      <span className="rh-progress-text">
        {viewedCount}/{totalFiles} viewed · ~{props.estimatedMinutes}m
      </span>
    </div>
  )
}

interface MenuItemProps {
  label: string
  hint?: React.ReactNode
  disabled?: boolean
  onSelect: () => void
}

function HeaderMenuItem(props: MenuItemProps & { close: () => void }) {
  return (
    <button
      type="button"
      role="menuitem"
      className="rh-menu-item"
      disabled={props.disabled}
      onClick={() => {
        props.onSelect()
        props.close()
      }}
    >
      <span>{props.label}</span>
      {props.hint && <span className="rh-menu-hint">{props.hint}</span>}
    </button>
  )
}

/** The "more" menu's items, in order; an item whose handler is absent is left out. */
function menuItems(props: ReviewHeaderProps): MenuItemProps[] {
  const items: (MenuItemProps | false)[] = [
    { label: 'Focus mode', hint: props.focusMode && 'On', onSelect: props.onToggleFocusMode },
    !!props.onShowOverview && { label: 'Overview', hint: 'i', onSelect: props.onShowOverview },
    { label: 'Hide file list', hint: 't', onSelect: props.onToggleFileList },
    { label: 'Refresh PR', disabled: props.refreshing, onSelect: props.onRefresh },
    !!props.onPopOut && { label: 'Pop out', onSelect: props.onPopOut },
    { label: 'Keyboard shortcuts', hint: '?', onSelect: props.onOpenKeyboardHelp },
  ]
  return items.filter((item): item is MenuItemProps => item !== false)
}

function MoreMenu({ header }: { header: ReviewHeaderProps }) {
  const [menuOpen, setMenuOpen] = useState(false)
  const closeHeaderMenu = () => setMenuOpen(false)
  return (
    <div className="rh-pill-wrap">
      <IconButton
        aria-haspopup="menu"
        aria-expanded={menuOpen}
        icon={MoreHorizontal}
        label="More review actions"
        onClick={() => setMenuOpen((v) => !v)}
      />
      {menuOpen && (
        <Popover label="Review actions" className="rh-popover" onDismiss={closeHeaderMenu}>
          <div role="menu" className="rh-menu">
            {menuItems(header).map((item) => (
              <HeaderMenuItem key={item.label} {...item} close={closeHeaderMenu} />
            ))}
          </div>
        </Popover>
      )}
    </div>
  )
}

function HeaderPills({ header }: { header: ReviewHeaderProps }) {
  const { checks, largePr, focusMode } = header
  return (
    <>
      {checks.length > 0 && <ChecksPill checks={checks} />}
      {largePr && <LargePrPill largePr={largePr} onDismiss={header.onDismissLargePr} />}
      {focusMode && (
        <button
          aria-pressed={focusMode}
          type="button"
          className="rh-pill rh-pill--focus"
          onClick={header.onToggleFocusMode}
        >
          Focus mode
        </button>
      )}
    </>
  )
}

/** One 44px row holding everything that is not the diff, in place of the old top bar, checks band,
 *  progress track and large-PR banner (design: docs/research/review-screen-declutter.md). */
export function ReviewHeader(props: ReviewHeaderProps): JSX.Element {
  return (
    <div className="rh-row">
      <span className="rh-num">#{props.prNumber}</span>
      {props.isDraft && <span className="rh-draft-badge">Draft</span>}
      <span className="rh-title">{props.title}</span>
      <HeaderPills header={props} />
      <div className="rh-spacer" />
      <ReviewProgress
        viewedCount={props.viewedCount}
        totalFiles={props.totalFiles}
        estimatedMinutes={props.estimatedMinutes}
      />
      <Button
        aria-label="Ask agent about this PR"
        variant="ghost"
        icon={Sparkles}
        onClick={props.onAskAgent}
      >
        Ask agent
      </Button>
      <MoreMenu header={props} />
      <IconButton icon={X} label="Close review" onClick={props.onClose} />
    </div>
  )
}
