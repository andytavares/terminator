import React from 'react'
import { Dialog } from './Dialog'

export interface ConfirmDialogProps {
  title: string
  description?: string
  /** Says what happens: "Remove" beats "Confirm". */
  confirmLabel?: string
  danger?: boolean
  onConfirm: () => void
  onClose: () => void
}

/**
 * The two-button case, narrowed from Dialog.
 *
 * This is the core app's own `ConfirmDialog` generalised — 61 lines that already
 * did Escape, focus, role and aria-modal correctly, and which Notepad reached
 * into `src/renderer/` to import because the platform published no way to ask
 * for one. Publishing it is what removes the temptation.
 *
 * Cancel is listed first so it takes initial focus: the safe choice should be
 * the one a reflexive Enter lands on.
 */
export function ConfirmDialog({
  title,
  description,
  confirmLabel = 'Confirm',
  danger = false,
  onConfirm,
  onClose,
}: ConfirmDialogProps): JSX.Element {
  return (
    <Dialog
      title={title}
      onDismiss={onClose}
      actions={[
        { label: 'Cancel', onSelect: onClose },
        {
          label: confirmLabel,
          tone: danger ? 'danger' : 'primary',
          onSelect: () => {
            onConfirm()
          },
        },
      ]}
    >
      {description !== undefined && <p className="tmui-dialog__description">{description}</p>}
    </Dialog>
  )
}
