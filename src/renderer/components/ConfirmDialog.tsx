import { ConfirmDialog as SharedConfirmDialog } from '@terminator/extension-ui'
import '@terminator/extension-ui/styles.css'
import { useModalEffect } from '../stores/modal.store'

interface ConfirmDialogProps {
  title: string
  description?: string
  confirmLabel?: string
  danger?: boolean
  onConfirm: () => void
  onClose: () => void
}

/**
 * The core app's confirmation, now the shared one.
 *
 * This used to be the only correct dialog in the product — 61 lines that did
 * Escape, focus, `role` and `aria-modal` properly — and Notepad reached across
 * into `src/renderer/` to import it because the Extension API published no way
 * to ask for one. That import was a Principle II violation, but the cause was
 * the missing contract, not carelessness.
 *
 * The implementation now lives in `@terminator/extension-ui`, where the
 * extensions can have it legitimately. This wrapper stays because it keeps the
 * core's own callers unchanged, and because `useModalEffect` is core-side state:
 * it suppresses the extension WebContentsViews while a host dialog is open,
 * which an extension-side dialog has no business doing.
 */
export function ConfirmDialog(props: ConfirmDialogProps) {
  useModalEffect()
  return <SharedConfirmDialog {...props} />
}
