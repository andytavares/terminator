import React from 'react'
import { HardDrive, AlertTriangle, Trash2 } from 'lucide-react'
import './supervision.css'

// Working copies outlive the sessions that made them: a crash between creating
// one and registering its session leaves a directory nothing knows about, and a
// session that finished still holds its checkout. Each costs a port span and
// however large the repository's dependencies are, and neither is visible from
// anywhere else — so they accumulate silently, which is the class of failure
// this console exists to surface rather than to add to.

export interface ReclaimableWorktreeView {
  readonly path: string
  readonly reason: 'orphan' | 'finished' | 'lost'
  readonly sessionId: string | null
  readonly branch: string | null
  readonly repoPath: string | null
}

export interface WorktreeReclaimProps {
  worktrees: readonly ReclaimableWorktreeView[]
  /** The path currently being removed, so its row can say so. */
  busyPath: string | null
  lastError: string | null
  onReclaim(path: string): void
  onReclaimAll(): void
  onRefresh(): void
}

const REASONS: Record<ReclaimableWorktreeView['reason'], string> = {
  orphan: 'no session references it',
  finished: 'its session has finished',
  lost: 'the console lost track of its session, and it changed nothing',
}

export function WorktreeReclaim({
  worktrees,
  busyPath,
  lastError,
  onReclaim,
  onReclaimAll,
  onRefresh,
}: WorktreeReclaimProps): JSX.Element {
  return (
    <div className="sv-panel">
      <div className="sv-panel__header">
        <span>
          <HardDrive aria-hidden="true" /> Working copies you can reclaim
        </span>
        <span className="sv-queue__actions">
          <button className="sv-queue__btn" onClick={onRefresh}>
            Refresh
          </button>
          {worktrees.length > 0 && (
            <button className="sv-queue__btn sv-btn--primary" onClick={onReclaimAll}>
              <Trash2 aria-hidden="true" /> Reclaim all {worktrees.length}
            </button>
          )}
        </span>
      </div>

      {lastError !== null && (
        <div className="sv-row">
          <span className="sv-warn">
            <AlertTriangle aria-hidden="true" />
            {lastError}
          </span>
        </div>
      )}

      {worktrees.length === 0 ? (
        // Asserted, not implied: an empty list and a check that never ran look
        // the same otherwise.
        <div className="sv-allclear">
          Nothing to reclaim. Every working copy belongs to a session that still needs it.
        </div>
      ) : (
        worktrees.map((worktree) => (
          <div className="sv-row" key={worktree.path}>
            <span className="sv-row__main">
              <div className="sv-queue__title">{worktree.path.split('/').pop()}</div>
              <div className="sv-queue__meta">
                {REASONS[worktree.reason]}
                {worktree.branch !== null && ` · ${worktree.branch}`}
              </div>
              <div className="sv-row__trigger">{worktree.path}</div>
            </span>
            <span className="sv-queue__actions">
              <button
                className="sv-queue__btn"
                disabled={busyPath === worktree.path}
                onClick={() => onReclaim(worktree.path)}
              >
                <Trash2 aria-hidden="true" />
                {busyPath === worktree.path ? 'Reclaiming…' : 'Reclaim'}
              </button>
            </span>
          </div>
        ))
      )}

      <div className="sv-form">
        <span className="sv-field__note">
          Reclaiming runs the repository&rsquo;s teardown script, removes the working copy, deletes
          the branch it was on, and frees its port range. A working copy still in use is never
          listed, and neither is one holding changes nobody has reviewed — a session that is ready
          for review, or one the console lost track of that had done work, keeps its checkout.
        </span>
      </div>
    </div>
  )
}
