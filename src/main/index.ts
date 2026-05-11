import { app, BrowserWindow, ipcMain, dialog, Menu } from 'electron'
import { join } from 'path'
import { registerWorkspaceHandlers } from './ipc/workspace.ipc.js'
import { registerTerminalHandlers } from './ipc/terminal.ipc.js'
import { registerSettingsHandlers } from './ipc/settings.ipc.js'
import { registerExtensionHandlers } from './ipc/extension.ipc.js'
import { registerGitHandlers } from './ipc/git.ipc.js'
import { registerShellHandlers } from './ipc/shell.ipc.js'
import { registerFsHandlers } from './ipc/fs.ipc.js'
import { registerLogHandlers } from './ipc/log.ipc.js'
import { PtyManager } from './terminal/pty-manager.js'
import { ExtensionHost } from './extensions/extension-host.js'
import { logger } from './logger.js'

let mainWindow: BrowserWindow | null = null
let prReviewWin: BrowserWindow | null = null
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

  mainWindow.on('closed', () => {
    mainWindow = null
  })
}

function createPrReviewWindow(repoRoot: string, accentColor?: string): void {
  const repoName = repoRoot.split('/').filter(Boolean).pop() ?? 'Code Review'
  const win = new BrowserWindow({
    width: 1400,
    height: 900,
    title: `Code Review — ${repoName}`,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      preload: join(__dirname, '../preload/index.js'),
    },
  })

  prReviewWin = win
  mainWindow?.webContents.send('window:pr-review-opened')

  win.on('closed', () => {
    prReviewWin = null
    mainWindow?.webContents.send('window:pr-review-closed')
  })

  const params: Record<string, string> = { view: 'pr-review', repoRoot }
  if (accentColor) params.accentColor = accentColor
  if (process.env.NODE_ENV === 'development' || process.env['ELECTRON_RENDERER_URL']) {
    const base = process.env['ELECTRON_RENDERER_URL'] || 'http://localhost:5173'
    win.loadURL(`${base}?${new URLSearchParams(params).toString()}`)
  } else {
    win.loadFile(join(__dirname, '../renderer/index.html'), { query: params })
  }
}

function setupMenu(): void {
  const template: Electron.MenuItemConstructorOptions[] = [
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
        { type: 'separator' },
        {
          label: 'Code Reviews in New Window',
          click: () => mainWindow?.webContents.send('menu:open-pr-review-window'),
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
  ]
  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
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
  registerDialogHandlers()

  ipcMain.handle('window:open-pr-review', (_event, payload) => {
    const { repoRoot, accentColor } = payload as { repoRoot: string; accentColor?: string }
    if (!repoRoot) return
    if (prReviewWin && !prReviewWin.isDestroyed()) {
      prReviewWin.focus()
      return
    }
    createPrReviewWindow(repoRoot, accentColor)
  })

  await extensionHost.loadAll()
  await extensionHost.loadBundledExtensions(join(__dirname, '../../extensions'))

  // Window is created after extensions load so the renderer can immediately
  // query the active extension list and only mount the correct renderers.
  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('before-quit', async (event) => {
  event.preventDefault()
  await ptyManager.killAll()
  app.exit(0)
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
