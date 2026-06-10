import { app, BrowserWindow, ipcMain, dialog, Menu, shell } from 'electron'
import { join } from 'path'
import { registerWorkspaceHandlers } from './ipc/workspace.ipc.js'
import { registerTerminalHandlers } from './ipc/terminal.ipc.js'
import { registerSettingsHandlers } from './ipc/settings.ipc.js'
import { registerExtensionHandlers } from './ipc/extension.ipc.js'
import { registerGitHandlers } from './ipc/git.ipc.js'
import { registerShellHandlers } from './ipc/shell.ipc.js'
import { registerFsHandlers } from './ipc/fs.ipc.js'
import { registerLogHandlers } from './ipc/log.ipc.js'
import { registerNotificationHandlers } from './ipc/notification.ipc.js'
import { registerMetricsHandlers } from './ipc/metrics.ipc.js'
import { PtyManager } from './terminal/pty-manager.js'
import { ExtensionHost } from './extensions/extension-host.js'
import { logger } from './logger.js'

declare module 'electron' {
  interface App {
    isQuitting?: boolean
  }
}

let mainWindow: BrowserWindow | null = null
const ptyManager = new PtyManager()
const extensionHost = new ExtensionHost()

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      preload: join(__dirname, '../preload/index.js'),
    },
  })

  if (process.env.NODE_ENV === 'development' || process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'] || 'http://localhost:5173')
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }

  // Redirect external http(s) link clicks and window.open() calls to the system browser.
  // Non-http URLs (e.g. same-origin navigations) are denied without opening externally.
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('http://') || url.startsWith('https://')) {
      shell.openExternal(url).catch(() => {})
    }
    return { action: 'deny' }
  })
  mainWindow.webContents.on('will-navigate', (event, url) => {
    if (url !== mainWindow!.webContents.getURL()) {
      event.preventDefault()
      if (url.startsWith('http://') || url.startsWith('https://')) {
        shell.openExternal(url).catch(() => {})
      }
    }
  })

  // On macOS, hide instead of destroy so PTY sessions and renderer state survive.
  // Full quit (Cmd+Q / right-click Quit) still goes through before-quit → killAll().
  if (process.platform === 'darwin') {
    mainWindow.on('close', (event) => {
      if (!app.isQuitting) {
        event.preventDefault()
        mainWindow?.hide()
      }
    })
  } else {
    mainWindow.on('closed', () => {
      mainWindow = null
    })
  }
}

function openAbout(): void {
  mainWindow?.webContents.send('menu:open-about')
}

function setupMenu(): void {
  const template: Electron.MenuItemConstructorOptions[] = [
    ...(process.platform === 'darwin'
      ? ([
          {
            label: app.getName(),
            submenu: [
              { label: `About ${app.getName()}`, click: openAbout },
              { type: 'separator' },
              { role: 'services' },
              { type: 'separator' },
              { role: 'hide' },
              { role: 'hideOthers' },
              { role: 'unhide' },
              { type: 'separator' },
              { role: 'quit' },
            ],
          },
        ] as Electron.MenuItemConstructorOptions[])
      : []),
    {
      label: 'File',
      submenu: [{ label: 'Quit', accelerator: 'CmdOrCtrl+Q', role: 'quit' }],
    },
    {
      label: 'Edit',
      submenu: [{ role: 'cut' }, { role: 'copy' }, { role: 'paste' }, { role: 'selectAll' }],
    },
    {
      label: 'View',
      submenu: [
        {
          label: 'Toggle Sidebar',
          click: () => mainWindow?.webContents.send('menu:toggle-sidebar'),
        },
        {
          label: 'Open Settings',
          accelerator: 'CmdOrCtrl+,',
          click: () => mainWindow?.webContents.send('menu:open-settings'),
        },
      ],
    },
    {
      label: 'Window',
      submenu: [
        {
          label: 'Close Tab',
          accelerator: 'CmdOrCtrl+W',
          click: () => mainWindow?.webContents.send('menu:close-tab'),
        },
      ],
    },
    {
      label: 'Help',
      submenu: [
        { label: `About ${app.getName()}`, click: openAbout },
        { type: 'separator' },
        {
          label: 'View on GitHub',
          click: () => void shell.openExternal('https://github.com/anthropics/terminator'),
        },
      ],
    },
  ]
  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
}

function registerAppHandlers(): void {
  ipcMain.handle('app:get-info', () => ({
    appName: app.getName(),
    version: app.getVersion(),
    electronVersion: process.versions.electron,
    nodeVersion: process.versions.node,
    chromeVersion: process.versions.chrome,
    platform: process.platform,
  }))
}

function registerDialogHandlers(): void {
  ipcMain.handle('dialog:open-directory', async () => {
    if (!mainWindow) return { cancelled: true }
    const result = await dialog.showOpenDialog(mainWindow, {
      properties: ['openDirectory'],
    })
    if (result.canceled || result.filePaths.length === 0) {
      return { cancelled: true }
    }
    return { filePath: result.filePaths[0] }
  })
}

app.whenReady().then(async () => {
  logger.info('App ready', { version: app.getVersion() })
  setupMenu()
  registerWorkspaceHandlers()
  registerTerminalHandlers(ptyManager, () => mainWindow)
  registerSettingsHandlers()
  registerExtensionHandlers(extensionHost)
  registerGitHandlers()
  registerShellHandlers()
  registerFsHandlers(() => mainWindow)
  registerLogHandlers()
  registerNotificationHandlers()
  registerMetricsHandlers(ptyManager)
  registerDialogHandlers()
  registerAppHandlers()

  await extensionHost.loadAll()
  await extensionHost.loadBundledExtensions(join(__dirname, '../../extensions'))

  // Window is created after extensions load so the renderer can immediately
  // query the active extension list and only mount the correct renderers.
  createWindow()

  app.on('activate', () => {
    if (mainWindow) {
      mainWindow.show()
    } else {
      createWindow()
    }
  })
})

app.on('before-quit', async (event) => {
  event.preventDefault()
  app.isQuitting = true
  await ptyManager.killAll()
  app.exit(0)
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
