import React from 'react'
import type { Project, TerminalSession } from '../../../shared/types/index'
import './BulkCloseDialog.css'

export interface BulkCloseDialogProps {
  sessions: TerminalSession[]
  projectById: Map<string, Project>
  onConfirm: (sessionIds: string[], worktreeProjectIds: string[]) => void
  onClose: () => void
}

/**
 * Confirms a bulk close, naming exactly what happens.
 *
 * Two rules are enforced here rather than left to the caller: a session
 * waiting on you is never closed by a bulk action (FR-023, SC-006), and any
 * worktree that will leave disk is listed by its real path before you confirm
 * (FR-024). Deleting files is not something to infer from a count.
 */
export function BulkCloseDialog({
  sessions,
  projectById,
  onConfirm,
  onClose,
}: BulkCloseDialogProps): JSX.Element {
  const closable = sessions.filter((s) => s.agentState !== 'awaiting-input')
  const skipped = sessions.length - closable.length

  // A worktree only leaves disk when every one of its project's selected
  // sessions is going and the project is worktree-backed.
  const worktrees = [...new Set(closable.map((s) => s.projectId))]
    .map((id) => projectById.get(id))
    .filter((p): p is Project => !!p && p.isWorktree && !!p.worktreePath)

  return (
    <div className="bulk-close__backdrop" onClick={onClose}>
      <div className="bulk-close" onClick={(e) => e.stopPropagation()}>
        <h2 className="bulk-close__title">
          Close {closable.length} session{closable.length === 1 ? '' : 's'}?
        </h2>

        <ul className="bulk-close__list">
          {closable.map((s) => (
            <li key={s.id}>{s.tabTitle}</li>
          ))}
        </ul>

        {skipped > 0 && (
          <p className="bulk-close__note">
            {skipped} session{skipped === 1 ? '' : 's'} waiting on you{' '}
            {skipped === 1 ? 'is' : 'are'} excluded and will stay open.
          </p>
        )}

        {worktrees.length > 0 && (
          <div className="bulk-close__worktrees">
            <p className="bulk-close__note bulk-close__note--danger">
              This also removes {worktrees.length} worktree
              {worktrees.length === 1 ? '' : 's'} from disk:
            </p>
            <ul className="bulk-close__list">
              {worktrees.map((p) => (
                <li key={p.id}>
                  <code>{p.worktreePath}</code>
                </li>
              ))}
            </ul>
          </div>
        )}

        <div className="bulk-close__actions">
          <button className="bulk-close__button" onClick={onClose}>
            Cancel
          </button>
          <button
            className="bulk-close__button bulk-close__button--danger"
            disabled={closable.length === 0}
            onClick={() =>
              onConfirm(
                closable.map((s) => s.id),
                worktrees.map((p) => p.id)
              )
            }
          >
            Close sessions
          </button>
        </div>
      </div>
    </div>
  )
}
