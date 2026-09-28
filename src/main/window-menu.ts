/**
 * The Window menu. Its `window` role makes macOS list every open window in it,
 * pop-outs included, and Cmd+` is left unbound so the OS can cycle through them.
 */
export function buildWindowMenu(
  send: (channel: string) => void
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
        label: 'Close Tab',
        accelerator: 'CmdOrCtrl+W',
        click: () => send('menu:close-tab'),
      },
      { type: 'separator' },
      { role: 'front' },
    ],
  }
}
