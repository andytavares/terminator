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

/** Keep mine or keep theirs: pressed while it is the pending choice. */
function KeepSideButton(props: {
  side: 'ours' | 'theirs'
  pending: string | undefined
  onClick: () => void
}) {
  const [label, key, indicator] =
    props.side === 'ours' ? ['Keep mine', 'M', 'mine'] : ['Keep theirs', 'T', 'theirs']
  const pressed = props.pending === props.side
  return (
    <Button
      size="sm"
      variant={pressed ? 'primary' : 'secondary'}
      aria-pressed={pressed}
      onClick={props.onClick}
      title={`${label} [${key}]`}
    >
      <span
        className={`action-bar__indicator action-bar__indicator--${indicator}`}
        aria-hidden="true"
      />
      {label} <kbd className="tmui-kbd">{key}</kbd>
    </Button>
  )
}

export function ActionBar(props: Props) {
  const { pendingResolution } = props
  const pending = pendingResolution?.strategy
  return (
    <div className="action-bar">
      <div className="action-bar__left">
        <KeepSideButton side="ours" pending={pending} onClick={props.onKeepMine} />
        <KeepSideButton side="theirs" pending={pending} onClick={props.onKeepTheirs} />
        <Button size="sm" onClick={props.onKeepBoth} title="Keep both [B]">
          Keep both <kbd className="tmui-kbd">B</kbd>
        </Button>
        <Button size="sm" onClick={props.onEdit} title="Edit manually [E]">
          Edit manually <kbd className="tmui-kbd">E</kbd>
        </Button>
      </div>
      <div className="action-bar__right">
        {pendingResolution && (
          <Button size="sm" variant="primary" onClick={props.onConfirm} title="Confirm [Enter]">
            Confirm <kbd className="tmui-kbd">↵</kbd>
          </Button>
        )}
      </div>
    </div>
  )
}
