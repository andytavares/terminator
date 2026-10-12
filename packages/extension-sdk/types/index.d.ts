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
