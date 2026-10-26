import React, { useState } from 'react'
import { AppWindow, X } from 'lucide-react'
import { useBreakoutStore } from '../../stores/breakout.store'
import { StateChip } from '../session/StateChip'
import type { BranchTerminal } from '../../sidebar/branch-rows'
import { ContextMenu, type ContextMenuItem } from '../ContextMenu'
import { activateOnKey, afterClosing, clickOnly } from './row-events'
import './TerminalRow.css'

export interface TerminalRowProps {
  terminal: BranchTerminal
  /** True for a pane split off a root terminal — indented one step further. */
  nested?: boolean
  selected: boolean
  onSelect: () => void
  onClose: () => void
  /**
   * Opens the link dialog for this terminal's own session — absent when
   * nothing links it. Present in both directions: linking a fresh one and
   * changing an existing one open the same dialog.
   */
  onLinkIssue?: () => void
  /** Removes this session's own link, handing it back to its branch's. */
  onRemoveLink?: () => void
}

/**
 * The row's own session link, else null — an inherited branch link is drawn
 * one line up already and is not this row's to repeat.
 */
function ownKey(terminal: BranchTerminal): string | null {
  return terminal.workItem?.source === 'session' ? terminal.workItem.ref.key : null
}

/**
 * One terminal under a branch, or one pane under a terminal.
 *
 * The sidebar stopped at the branch and reported a count, so a terminal — and
 * especially a split pane — existed on screen and nowhere else: no name, no
 * state, no way to reach it, and no way to close it but a shortcut. This is
 * the row that says what is there.
 *
 * It borrows the branch row's anatomy on purpose: the same status gutter in
 * the same column, so scanning for what needs you is still one column top to
 * bottom rather than a search across three kinds of row.
 */
export function TerminalRow(props: TerminalRowProps): JSX.Element {
  const { terminal, nested = false, selected, onSelect, onClose, onLinkIssue } = props
  const { menu, closeMenu, openMenu } = useLinkMenu(onLinkIssue !== undefined)
  const key = ownKey(terminal)

  return (
    <div
      className={`terminal-row${nested ? ' terminal-row--nested' : ''}${
        selected ? ' terminal-row--selected' : ''
      }`}
      role="button"
      tabIndex={0}
      aria-current={selected ? 'true' : undefined}
      onClick={onSelect}
      onKeyDown={activateOnKey(onSelect)}
      onContextMenu={openMenu}
    >
      <TerminalRowContent terminal={terminal} linkKey={key} onClose={onClose} />
      {menu && (
        <ContextMenu
          x={menu.x}
          y={menu.y}
          items={linkItems(props, key, closeMenu)}
          onDismiss={closeMenu}
        />
      )}
    </div>
  )
}

/** Where the link menu is open, if it is; no menu at all when nothing can link. */
function useLinkMenu(canLink: boolean) {
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null)
  const openLinkMenu = (e: React.MouseEvent): void => {
    e.preventDefault()
    e.stopPropagation()
    setMenu({ x: e.clientX, y: e.clientY })
  }
  return { menu, closeMenu: () => setMenu(null), openMenu: canLink ? openLinkMenu : undefined }
}

/** Link issue… for a session with no link of its own, else change or remove that link. Each
 * closes the menu first. */
function linkItems(
  { onLinkIssue, onRemoveLink }: TerminalRowProps,
  key: string | null,
  closeMenu: () => void
): ContextMenuItem[] {
  const run = (fn?: () => void) => afterClosing(closeMenu, () => fn?.())
  if (key === null) return [{ label: 'Link issue…', onSelect: run(onLinkIssue) }]
  return [
    { label: 'Change linked issue…', onSelect: run(onLinkIssue) },
    { label: 'Remove session link', danger: true, onSelect: run(onRemoveLink) },
  ]
}

interface ContentProps {
  terminal: BranchTerminal
  linkKey: string | null
  onClose: () => void
}

/** The terminal's state, or a window icon when it lives in a window of its own. */
function TerminalGutter({ terminal }: { terminal: BranchTerminal }): JSX.Element {
  const isBrokenOut = useBreakoutStore((s) => s.windows.has(terminal.sessionId))
  return (
    <span className="terminal-row__gutter">
      {isBrokenOut ? (
        <span className="terminal-row__window" title="In its own window">
          <AppWindow aria-hidden="true" />
        </span>
      ) : (
        <StateChip state={terminal.state} compact />
      )}
    </span>
  )
}

/** State chip, name, own link key, unseen bells, and the close button. */
function TerminalRowContent({ terminal, linkKey, onClose }: ContentProps): JSX.Element {
  return (
    <>
      <TerminalGutter terminal={terminal} />
      <span className="terminal-row__name" title={terminal.title}>
        {terminal.title}
      </span>
      {linkKey !== null && <span className="terminal-row__key">{linkKey}</span>}
      {terminal.bellCount > 0 && (
        <span className="terminal-row__bell" aria-label={`${terminal.bellCount} unseen`}>
          {terminal.bellCount}
        </span>
      )}
      <button
        type="button"
        className="terminal-row__close"
        aria-label={`Close ${terminal.title}`}
        title="Close terminal"
        onClick={clickOnly(onClose)}
      >
        <X aria-hidden="true" />
      </button>
    </>
  )
}
