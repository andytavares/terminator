import React, { useState } from 'react'
import { ArrowLeft, Sparkles, MoreHorizontal, X } from 'lucide-react'
import { Button, IconButton, Menu, Popover } from '@terminator/extension-ui'
import { StatusChecksBar } from './StatusChecksBar'
import type { StatusCheck } from '../../schemas/pr-review.schema'
import './review-header.css'
import './review-layout.css'

/** One chapter's slice of the progress bar. */
export interface ChapterProgress {
  id: string
  fileCount: number
  viewedCount: number
}

export interface ReviewHeaderProps {
  prNumber: number
  title: string
  isDraft: boolean
  checks: StatusCheck[]
  viewedCount: number
  totalFiles: number
  chapters: ChapterProgress[]
  onPause: () => void
  onAskAgent: () => void
  onShowOverview?: () => void
  onPopOut?: () => void
  onRefresh: () => void
  refreshing: boolean
  onOpenKeyboardHelp: () => void
  onClose: () => void
}

type PillState = StatusCheck['state']

function checksTone(checks: StatusCheck[]): PillState {
  if (checks.some((c) => c.state === 'fail')) return 'fail'
  if (checks.some((c) => c.state === 'pending')) return 'pending'
  return 'pass'
}

/** "2 of 8 checks failing", "1 of 8 checks pending", or "Checks pass". */
function checksLabel(checks: StatusCheck[]): string {
  const failCount = checks.filter((c) => c.state === 'fail').length
  const pendingCount = checks.filter((c) => c.state === 'pending').length
  if (failCount > 0) return `${failCount} of ${checks.length} checks failing`
  if (pendingCount > 0) return `${pendingCount} of ${checks.length} checks pending`
  return 'Checks pass'
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
        <Popover
          label={props.label}
          align="end"
          className="rh-popover"
          onDismiss={() => setOpen(false)}
        >
          {props.children}
        </Popover>
      )}
    </div>
  )
}

/** Passing checks are a quiet status dot; a failing or pending check is the warning pill. */
function checksClass(tone: PillState): string {
  if (tone === 'pass') return 'rh-checks-quiet'
  return `rh-pill rh-pill--${tone}`
}

function ChecksPill({ checks }: { checks: StatusCheck[] }) {
  const tone = checksTone(checks)
  const pill = (
    <>
      {tone === 'pass' && <span className="rh-checks-dot" aria-hidden="true" />}
      {checksLabel(checks)}
    </>
  )
  return (
    <PillPopover pillClass={checksClass(tone)} pill={pill} label="Status checks">
      <StatusChecksBar checks={checks} defaultExpanded />
    </PillPopover>
  )
}

function filledPercent(chapter: ChapterProgress): number {
  if (chapter.fileCount <= 0) return 0
  return (chapter.viewedCount / chapter.fileCount) * 100
}

/** One segment per chapter, as wide as the chapter has files. */
function ChapterSegments(props: {
  chapters: ChapterProgress[]
  viewedCount: number
  totalFiles: number
}) {
  return (
    <div
      role="progressbar"
      aria-label="Files viewed"
      aria-valuemin={0}
      aria-valuemax={props.totalFiles}
      aria-valuenow={props.viewedCount}
      className="rh-segments"
    >
      {props.chapters.map((chapter) => (
        <i
          key={chapter.id}
          data-testid="progress-segment"
          style={
            {
              flexGrow: chapter.fileCount,
              '--filled': `${filledPercent(chapter)}%`,
            } as React.CSSProperties
          }
        />
      ))}
    </div>
  )
}

function ReviewProgress(props: ReviewHeaderProps) {
  const { viewedCount, totalFiles } = props
  return (
    <div className="rh-progress">
      <ChapterSegments
        chapters={props.chapters}
        viewedCount={viewedCount}
        totalFiles={totalFiles}
      />
      <span className="rh-progress-text">
        {viewedCount} of {totalFiles} viewed
      </span>
    </div>
  )
}

interface MenuItemProps {
  label: string
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
    </button>
  )
}

/** The "more" menu's actions, in order. An action whose handler is absent is left out. */
function menuItems(props: ReviewHeaderProps): MenuItemProps[] {
  const items: (MenuItemProps | false)[] = [
    !!props.onShowOverview && { label: 'Overview', onSelect: props.onShowOverview },
    { label: 'Pause review', onSelect: props.onPause },
    { label: 'Refresh pull request', disabled: props.refreshing, onSelect: props.onRefresh },
    !!props.onPopOut && { label: 'Pop out', onSelect: props.onPopOut },
    { label: 'Keyboard shortcuts', onSelect: props.onOpenKeyboardHelp },
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
        <Menu
          label="Review actions"
          align="end"
          className="rh-popover rh-menu"
          onDismiss={closeHeaderMenu}
        >
          {menuItems(header).map((item) => (
            <HeaderMenuItem key={item.label} {...item} close={closeHeaderMenu} />
          ))}
        </Menu>
      )}
    </div>
  )
}

/** One 44px row holding everything that is not the diff, in place of the old top bar, checks band,
 *  and progress track (design: docs/research/review-screen-declutter.md). */
export function ReviewHeader(props: ReviewHeaderProps): React.JSX.Element {
  return (
    <div className="rh-row">
      {props.onShowOverview && (
        <IconButton icon={ArrowLeft} label="Back to overview" onClick={props.onShowOverview} />
      )}
      <span className="rh-title">{props.title}</span>
      <span className="rh-num">#{props.prNumber}</span>
      {props.isDraft && <span className="rh-draft-badge">Draft</span>}
      {props.checks.length > 0 && <ChecksPill checks={props.checks} />}
      <div className="rh-spacer" />
      <ReviewProgress {...props} />
      <div className="rh-actions">
        <Button
          aria-label="Ask agent about this PR"
          variant="ghost"
          icon={Sparkles}
          onClick={props.onAskAgent}
        >
          <span className="rh-ask-label">Ask agent</span>
        </Button>
      </div>
      <MoreMenu header={props} />
      <IconButton icon={X} label="Close review" onClick={props.onClose} />
    </div>
  )
}
