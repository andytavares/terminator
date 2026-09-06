/**
 * @terminator/extension-ui — the shared UI floor.
 *
 * One dialog, one confirmation, one toast, one empty state, one icon button and
 * one layer scale, used by the core application and by every extension. The
 * Extension API published 31 colour tokens and no components, so all five
 * extensions built their own and disagreed with each other about what a
 * keypress means; this is the piece that was missing.
 */

export { Dialog, DialogActionButton, useContainingLayer } from './Dialog'
export type { DialogAction, DialogProps } from './Dialog'

export { Popover } from './Popover'
export type { PopoverProps } from './Popover'

export { ConfirmDialog } from './ConfirmDialog'
export type { ConfirmDialogProps } from './ConfirmDialog'

export { Toast, ToastRegion } from './Toast'
export type { ToastItem, ToastProps, ToastRegionProps, ToastTone } from './Toast'

export { EmptyState } from './EmptyState'
export type { EmptyStateProps } from './EmptyState'

export { IconButton } from './IconButton'
export type { IconButtonProps } from './IconButton'

export {
  LAYERS,
  LAYER_NAMES,
  layerCssDeclarations,
  layerCssVar,
  layerValue,
  nestedLayerValue,
} from './layers'
export type { LayerName } from './layers'

export { createModalDepthRegistry, getModalDepth, MODAL_DEPTH_KEY } from './modal-depth'
export type { ModalDepthRegistry } from './modal-depth'

export { useDismissible } from './useDismissible'
export type { DismissibleOptions } from './useDismissible'

export { captureFocus, focusableWithin, trapTab } from './focus-trap'
