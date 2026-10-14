/**
 * @terminator/extension-ui — the shared UI floor.
 *
 * One dialog, one confirmation, one toast, one empty state, one icon button and
 * one layer scale, used by the core application and by every extension. The
 * Extension API published 31 colour tokens and no components, so all five
 * extensions built their own and disagreed with each other about what a
 * keypress means; this is the piece that was missing. Since ADR 098 it is the
 * design system: it also holds the tokens (`tokens.css`), a button, tabs, a
 * segmented control, Markdown, relative time and polling.
 */

export { ModalShell } from './ModalShell'
export type { ModalShellProps } from './ModalShell'

export { Dialog, DialogActionButton } from './Dialog'
export type { DialogAction, DialogProps } from './Dialog'

export { Button } from './Button'
export type { ButtonProps, ButtonSize, ButtonVariant } from './Button'

export { Tab, TabList, TabPanel, Tabs, TabsRoot } from './Tabs'
export type {
  TabItem,
  TabListProps,
  TabOrientation,
  TabPanelProps,
  TabProps,
  TabsProps,
  TabsRootProps,
} from './Tabs'

export { SegmentedControl } from './SegmentedControl'
export type { SegmentedControlProps, SegmentedOption } from './SegmentedControl'

export { ListInput, listItems } from './ListInput'
export type { ListInputProps } from './ListInput'

export { Markdown } from './Markdown'
export type { MarkdownProps } from './Markdown'

export { RelativeTime } from './RelativeTime'
export type { RelativeTimeProps } from './RelativeTime'
export { formatRelativeTime } from './relative-time'
export type { TimeInput } from './relative-time'

export { usePolling, everyWhileVisible } from './usePolling'

export { Popover } from './Popover'
export type { PopoverProps } from './Popover'

export { ConfirmDialog } from './ConfirmDialog'
export type { ConfirmDialogProps } from './ConfirmDialog'

export { Toast, ToastRegion } from './Toast'
export { installIconTooltips } from './icon-tooltips'
export { createToastStore } from './toast-store'
export type { QueuedToast, ToastQueue } from './toast-store'
export type { ToastItem, ToastProps, ToastRegionProps, ToastTone } from './Toast'

export { EmptyState } from './EmptyState'
export type { EmptyStateProps } from './EmptyState'

export { IconButton } from './IconButton'
export type { IconButtonProps, IconButtonSize } from './IconButton'

export { LAYERS, LAYER_NAMES, layerCssDeclarations, layerCssVar, layerValue } from './layers'
export type { LayerName } from './layers'

export { createModalDepthRegistry, getModalDepth, MODAL_DEPTH_KEY } from './modal-depth'
export type { ModalDepthHost, ModalDepthRegistry } from './modal-depth'

export { useDismissible } from './useDismissible'
export type { DismissibleOptions } from './useDismissible'
