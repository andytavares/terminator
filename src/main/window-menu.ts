/**
 * The Window menu. Its `window` role makes macOS list every open window in it,
 * pop-outs included, and Cmd+` is left unbound so the OS can cycle through them.
 */
type Send = (channel: string, payload?: unknown) => void

/** Close and move-between-windows act on the focused breakout's terminal, or on the main window's. */
function closeAndMoveItems(
  send: Send,
  focusedBreakoutSession: string | null
): Electron.MenuItemConstructorOptions[] {
  return [
    {
      label: focusedBreakoutSession ? 'Close Terminal' : 'Close Tab',
      accelerator: 'CmdOrCtrl+W',
      click: () => send('menu:close-tab', { sessionId: focusedBreakoutSession }),
    },
    {
      label: focusedBreakoutSession
        ? 'Return Terminal to Main Window'
        : 'Move Terminal to Its Own Window',
      accelerator: 'CmdOrCtrl+Shift+O',
      click: () => send('menu:toggle-breakout', { sessionId: focusedBreakoutSession }),
    },
  ]
}

// Ctrl, not Cmd: Cmd+1–9 belong to tabs elsewhere, and a menu accelerator fires even while the
// terminal has focus (xterm swallows renderer keydowns).
const LANE_COUNT = 9

/** Ctrl+1–9 show that lane of the task the visible branch is in. */
function switchLaneMenu(send: Send): Electron.MenuItemConstructorOptions {
  return {
    label: 'Switch Lane',
    submenu: Array.from({ length: LANE_COUNT }, (_, lane) => ({
      label: `Lane ${lane + 1}`,
      accelerator: `Control+${lane + 1}`,
      click: () => send('menu:switch-lane', { lane }),
    })),
  }
}

export function buildWindowMenu(
  send: Send,
  focusedBreakoutSession: string | null
): Electron.MenuItemConstructorOptions {
  return {
    label: 'Window',
    role: 'window',
    submenu: [
      { role: 'minimize' },
      { role: 'zoom' },
      { type: 'separator' },
      {
        label: 'Home',
        accelerator: 'CmdOrCtrl+Shift+H',
        click: () => send('menu:open-home'),
      },
      {
        label: 'Switch Task…',
        accelerator: 'CmdOrCtrl+J',
        click: () => send('menu:open-task-switcher'),
      },
      switchLaneMenu(send),
      ...closeAndMoveItems(send, focusedBreakoutSession),
      { type: 'separator' },
      { role: 'front' },
    ],
  }
}
