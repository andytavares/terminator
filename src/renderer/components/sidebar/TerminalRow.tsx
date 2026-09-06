import React from 'react'
import { X } from 'lucide-react'
import { ICON_FOR_STATE, STATUS_ICON } from '../../sidebar/state-icons'
import type { BranchTerminal } from '../../sidebar/branch-rows'
import './TerminalRow.css'

export interface TerminalRowProps {
  terminal: BranchTerminal
  /** True for a pane split off a root terminal — indented one step further. */
  nested?: boolean
  selected: boolean
  onSelect: () => void
  onClose: () => void
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
export function TerminalRow({
  terminal,
  nested = false,
  selected,
  onSelect,
  onClose,
}: TerminalRowProps): JSX.Element {
  const Glyph = STATUS_ICON[ICON_FOR_STATE[terminal.state]]

  return (
    <div
      className={`terminal-row${nested ? ' terminal-row--nested' : ''}${
        selected ? ' terminal-row--selected' : ''
      }`}
      role="button"
      tabIndex={0}
      onClick={onSelect}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          onSelect()
        }
      }}
    >
      <span className={`terminal-row__gutter terminal-row__state--${terminal.state}`}>
        <Glyph aria-hidden="true" data-state={terminal.state} />
      </span>

      <span className="terminal-row__name" title={terminal.title}>
        {terminal.title}
      </span>

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
        onClick={(e) => {
          e.stopPropagation()
          onClose()
        }}
      >
        <X aria-hidden="true" />
      </button>
    </div>
  )
}
