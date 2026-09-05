import React from 'react'
import type { LucideIcon } from 'lucide-react'
import { DialogActionButton, type DialogAction } from './Dialog'
import './extension-ui.css'

export interface EmptyStateProps {
  icon?: LucideIcon
  /** States the situation: "No notes yet". */
  heading: string
  /** One sentence, in the reader's language rather than the system's. */
  description: string
  /**
   * At least one, enforced by the type.
   *
   * An empty region is an invitation to act. The versions this replaces —
   * "No backlog items.", "Nothing is running.", "No staged changes" — stated an
   * absence in grey italic and offered nothing to do about it.
   */
  actions: readonly [DialogAction, ...DialogAction[]]
  /** The gesture worth learning while you are here. */
  hint?: React.ReactNode
}

export function EmptyState({
  icon: Icon,
  heading,
  description,
  actions,
  hint,
}: EmptyStateProps): JSX.Element {
  return (
    <div className="tmui-empty">
      {Icon && (
        <span className="tmui-empty__icon">
          <Icon aria-hidden="true" />
        </span>
      )}
      <h3 className="tmui-empty__heading">{heading}</h3>
      <p className="tmui-empty__description">{description}</p>
      <div className="tmui-empty__actions">
        {actions.map((action) => (
          <DialogActionButton key={action.label} action={action} />
        ))}
      </div>
      {hint !== undefined && <div className="tmui-empty__hint">{hint}</div>}
    </div>
  )
}
