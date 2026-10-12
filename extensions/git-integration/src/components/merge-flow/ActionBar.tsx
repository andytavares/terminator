import React from 'react'
import { Button } from '@terminator/extension-ui'

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
        <Button
          size="sm"
          variant={pendingResolution?.strategy === 'ours' ? 'primary' : 'secondary'}
          aria-pressed={pendingResolution?.strategy === 'ours'}
          onClick={onKeepMine}
          title="Keep mine [M]"
        >
          <span className="action-bar__indicator action-bar__indicator--mine" aria-hidden="true" />
          Keep mine <kbd className="tmui-kbd">M</kbd>
        </Button>
        <Button
          size="sm"
          variant={pendingResolution?.strategy === 'theirs' ? 'primary' : 'secondary'}
          aria-pressed={pendingResolution?.strategy === 'theirs'}
          onClick={onKeepTheirs}
          title="Keep theirs [T]"
        >
          <span
            className="action-bar__indicator action-bar__indicator--theirs"
            aria-hidden="true"
          />
          Keep theirs <kbd className="tmui-kbd">T</kbd>
        </Button>
        <Button size="sm" onClick={onKeepBoth} title="Keep both [B]">
          Keep both <kbd className="tmui-kbd">B</kbd>
        </Button>
        <Button size="sm" onClick={onEdit} title="Edit manually [E]">
          Edit manually <kbd className="tmui-kbd">E</kbd>
        </Button>
      </div>
      <div className="action-bar__right">
        {pendingResolution && (
          <Button size="sm" variant="primary" onClick={onConfirm} title="Confirm [Enter]">
            Confirm <kbd className="tmui-kbd">↵</kbd>
          </Button>
        )}
      </div>
    </div>
  )
}
