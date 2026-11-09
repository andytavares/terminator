/**
 * The View and Help menus. They take what they act on as arguments, so a unit test can build them
 * without Electron, as window-menu.ts does for the Window menu.
 */
type Send = (channel: string, payload?: unknown) => void

export interface ViewMenuActions {
  send: Send
  /** Presses Cmd+Alt+`keyCode` in the window, for a key the renderer handles itself. */
  pressKey: (keyCode: string) => void
  openDevTools: () => void
  extensionItems: Electron.MenuItemConstructorOptions[]
}

const REPOSITORY_URL = 'https://github.com/anthropics/terminator'

/** A menu item for a key the renderer handles itself: it shows the accelerator and presses the key,
 * so the renderer keeps the one handler. `registerAccelerator: false` lets the real key reach the page. */
function pressedKeyItem(
  label: string,
  accelerator: string,
  press: () => void
): Electron.MenuItemConstructorOptions {
  return { label, accelerator, registerAccelerator: false, click: press }
}

export function buildViewMenu(actions: ViewMenuActions): Electron.MenuItemConstructorOptions {
  const { send, pressKey, openDevTools, extensionItems } = actions
  return {
    label: 'View',
    submenu: [
      {
        label: 'Toggle Sidebar',
        accelerator: 'CmdOrCtrl+B',
        click: () => send('menu:toggle-sidebar'),
      },
      { type: 'separator' },
      pressedKeyItem('Go Back', 'CmdOrCtrl+Alt+Left', () => pressKey('Left')),
      pressedKeyItem('Go Forward', 'CmdOrCtrl+Alt+Right', () => pressKey('Right')),
      pressedKeyItem('Reopen Closed Tab', 'CmdOrCtrl+Alt+T', () => pressKey('T')),
      { type: 'separator' },
      ...extensionItems,
      ...(extensionItems.length > 0 ? [{ type: 'separator' as const }] : []),
      {
        label: 'Open Settings',
        accelerator: 'CmdOrCtrl+,',
        click: () => send('menu:open-settings'),
      },
      { type: 'separator' },
      { label: 'Open Extension DevTools', accelerator: 'CmdOrCtrl+Shift+I', click: openDevTools },
    ],
  }
}

export interface HelpMenuActions {
  openAbout: () => void
  openExternal: (url: string) => void
  reportBug: () => void
}

export function buildHelpMenu(
  appName: string,
  { openAbout, openExternal, reportBug }: HelpMenuActions
): Electron.MenuItemConstructorOptions {
  return {
    label: 'Help',
    submenu: [
      { label: `About ${appName}`, click: openAbout },
      { type: 'separator' },
      { label: 'Report a Bug…', accelerator: 'CmdOrCtrl+Shift+B', click: reportBug },
      { label: 'View on GitHub', click: () => openExternal(REPOSITORY_URL) },
    ],
  }
}

interface CheckableMenu {
  getMenuItemById(id: string): { checked: boolean } | null
}

/** Ticks a panel's View item to match what the window reports: open or closed. */
export function tickPanelItem(
  menu: CheckableMenu | null,
  menuItemId: string | undefined,
  open: boolean
): void {
  if (!menuItemId) return
  const item = menu?.getMenuItemById(menuItemId)
  if (item) item.checked = open
}
