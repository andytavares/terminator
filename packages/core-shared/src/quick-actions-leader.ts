/** A key press, in the field names of Electron's `Input`. */
export interface LeaderKeyPress {
  key: string
  meta: boolean
  control: boolean
  shift: boolean
  alt: boolean
}

/** Whether a key press is the quick-actions leader, CmdOrCtrl+P: ⌘P on macOS and Ctrl+P
 * elsewhere, as Electron's `CmdOrCtrl` accelerator modifier reads. */
export function isQuickActionsLeader(press: LeaderKeyPress, mac: boolean): boolean {
  if (press.key.toLowerCase() !== 'p') return false
  if (press.shift || press.alt) return false
  return mac ? press.meta : press.control
}
