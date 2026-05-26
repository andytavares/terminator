import React from 'react'

interface Props {
  pendingResolution: { text: string; strategy: string } | null
  onKeepMine: () => void
  onKeepTheirs: () => void
  onKeepBoth: () => void
  onEdit: () => void
  onConfirm: () => void
}

export function ActionBar({
  pendingResolution,
  onKeepMine,
  onKeepTheirs,
  onKeepBoth,
  onEdit,
  onConfirm,
}: Props) {
  return (
    <div className="action-bar">
      <div className="action-bar__left">
        <button
          className={`action-bar__btn action-bar__btn--mine${pendingResolution?.strategy === 'ours' ? ' action-bar__btn--active' : ''}`}
          onClick={onKeepMine}
          title="Keep mine [M]"
        >
          <span className="action-bar__indicator action-bar__indicator--mine">▼</span>
          Keep mine <kbd>M</kbd>
        </button>
        <button
          className={`action-bar__btn action-bar__btn--theirs${pendingResolution?.strategy === 'theirs' ? ' action-bar__btn--active' : ''}`}
          onClick={onKeepTheirs}
          title="Keep theirs [T]"
        >
          <span className="action-bar__indicator action-bar__indicator--theirs">▼</span>
          Keep theirs <kbd>T</kbd>
        </button>
        <button className="action-bar__btn" onClick={onKeepBoth} title="Keep both [B]">
          Keep both <kbd>B</kbd>
        </button>
        <button className="action-bar__btn" onClick={onEdit} title="Edit manually [E]">
          Edit manually <kbd>E</kbd>
        </button>
      </div>
      <div className="action-bar__right">
        {pendingResolution && (
          <button
            className="action-bar__btn action-bar__btn--confirm"
            onClick={onConfirm}
            title="Confirm [Enter]"
          >
            Confirm <kbd>↵</kbd>
          </button>
        )}
      </div>
    </div>
  )
}
