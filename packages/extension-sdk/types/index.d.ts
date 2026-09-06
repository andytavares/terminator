export type { ExtensionAPI, Disposable } from './api'
export type { ElectronAPI, NotificationTarget, SerializedNotification } from './renderer'

/**
 * Curated set of icon names supported by Terminator's `iconFromName` helper.
 * Use these strings in `manifest.json` `contributes.*.icon` fields.
 */
export const ICON_NAMES: readonly [
  'puzzle',
  'wrench',
  'terminal',
  'git-branch',
  'git-pull-request',
  'database',
  'code',
  'layers',
  'settings',
  'file',
  'search',
  'box',
  'star',
  'zap',
  'globe',
  'cpu',
  'flask',
  'chart-bar',
  'list',
  'calendar',
  'check',
]

export type IconName = (typeof ICON_NAMES)[number]

// ── The shared UI floor (v1.3.0) ─────────────────────────────────────────────
//
// The components themselves ship as the runtime package
// `@terminator/extension-ui`, because React components cannot cross a
// contextBridge — it serialises, and a component is a function. What the
// ExtensionAPI carries is what main-process code legitimately needs.

/** Matches the core's ToastType, so no caller has to relearn it. */
export type ExtensionToastTone = 'info' | 'success' | 'warning' | 'error'

/**
 * The stacking order. Extensions style against these, never raw numbers.
 * Ordering is the contract; the values are the implementation.
 */
export type ExtensionUiLayer = 'panel' | 'overlay' | 'modal' | 'toast'

export interface ExtensionUiApi {
  /** Raise a toast in this extension's view. */
  toast(message: string, options?: { tone?: ExtensionToastTone; duration?: number }): void
  readonly layers: Readonly<Record<ExtensionUiLayer, number>>
}
