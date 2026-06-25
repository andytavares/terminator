import { app, BrowserWindow, ipcMain, dialog, Menu, shell, net, session, protocol } from 'electron'
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
import { registerDbIpcHandlers } from './ipc/db.ipc.js'
import { PtyManager } from './terminal/pty-manager.js'
import { ExtensionHost } from './extensions/extension-host.js'
import { ExtensionViewHost } from './extensions/extension-view-host.js'
import { logger } from './logger.js'
import { bridgeEventBus } from './remote/bridge-event-bus.js'
import { REMOTE_ACCESSIBLE_CHANNELS } from './remote/remote-accessible-channels.js'
import {
  ipcInvokeRegistry,
  ipcSendRegistry,
  type IpcHandler,
  type IpcSendHandler,
} from './remote/ipc-registry.js'
import { initAppDb, getAppDb, closeAppDb } from './db/index.js'
import { runLegacyMigration } from './db/migrate.js'
import { globalRegistry, setMenuRebuildCallback } from './extensions/api.js'

// Intercept ipcMain.handle/on to capture handlers into the bridge registry
// so the remote-control extension bridge can dispatch IPC calls from browser clients.

const _origHandle = ipcMain.handle.bind(ipcMain)
const _origOn = ipcMain.on.bind(ipcMain)
const _origRemoveHandler = ipcMain.removeHandler.bind(ipcMain)
// @ts-expect-error - patch to intercept all handler registrations
ipcMain.handle = (channel: string, fn: IpcHandler, opts?: { remoteAccessible?: boolean }) => {
  // Default the remote-access flag from the central allowlist so the bridge
  // surface is auditable in one place (remote-accessible-channels.ts). An explicit
  // opt-in flag at the call site still wins if a future channel needs to override.
  const remoteAccessible = opts?.remoteAccessible ?? REMOTE_ACCESSIBLE_CHANNELS.has(channel)
  ipcInvokeRegistry.set(channel, { handler: fn, remoteAccessible })
  return _origHandle(channel, fn)
}
// @ts-expect-error - patch to intercept fire-and-forget handlers
ipcMain.on = (channel: string, fn: IpcSendHandler) => {
  ipcSendRegistry.set(channel, fn)
  return _origOn(channel, fn)
}
// @ts-expect-error - patch to keep bridge registry in sync when handlers are removed
ipcMain.removeHandler = (channel: string) => {
  ipcInvokeRegistry.delete(channel)
  return _origRemoveHandler(channel)
}

declare module 'electron' {
  interface App {
    isQuitting?: boolean
  }
}

let mainWindow: BrowserWindow | null = null
let viewHost: ExtensionViewHost | null = null
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
      webviewTag: true,
    },
  })

  viewHost = new ExtensionViewHost(mainWindow, join(__dirname, '../preload/webview.js'))

  if (process.env.NODE_ENV === 'development' || process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'] || 'http://localhost:5173')
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }

  // Forward all main→renderer IPC push events to browser bridge clients
  const _origSend = mainWindow.webContents.send.bind(mainWindow.webContents)
  mainWindow.webContents.send = (channel: string, ...args: unknown[]) => {
    _origSend(channel, ...args)
    bridgeEventBus.emit(channel, ...args)
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

function buildViewSubmenu(): Electron.MenuItemConstructorOptions[] {
  const base: Electron.MenuItemConstructorOptions[] = [
    {
      label: 'Toggle Sidebar',
      accelerator: 'CmdOrCtrl+B',
      click: () => mainWindow?.webContents.send('menu:toggle-sidebar'),
    },
    { type: 'separator' },
  ]

  const extItems = Array.from(globalRegistry.nativeMenuItems.values()).map((contrib) => {
    const id = `ext-menu-${contrib.id}`
    if (contrib.panelId) globalRegistry.panelMenuItemIds.set(contrib.panelId, id)
    return {
      id,
      label: contrib.label,
      accelerator: contrib.accelerator,
      type: (contrib.type === 'checkbox' ? 'checkbox' : 'normal') as 'checkbox' | 'normal',
      checked: false,
      click: () => contrib.onClick(),
    } as Electron.MenuItemConstructorOptions
  })

  const tail: Electron.MenuItemConstructorOptions[] = [
    ...(extItems.length > 0 ? [{ type: 'separator' as const }] : []),
    {
      label: 'Open Settings',
      accelerator: 'CmdOrCtrl+,',
      click: () => mainWindow?.webContents.send('menu:open-settings'),
    },
  ]

  return [...base, ...extItems, ...tail]
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
      submenu: buildViewSubmenu(),
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

// Wire up api.ts so extension activations can trigger a full menu rebuild
// from MenuItemConstructorOptions (preserving all accelerators and click handlers).
setMenuRebuildCallback(setupMenu)

function registerAppHandlers(): void {
  _origOn(
    'menu:set-panel-checked',
    (_event, { panelId, open }: { panelId: string; open: boolean }) => {
      const menuItemId = globalRegistry.panelMenuItemIds.get(panelId)
      if (menuItemId) {
        const menuItem = Menu.getApplicationMenu()?.getMenuItemById(menuItemId)
        if (menuItem) menuItem.checked = open
      }
    }
  )

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

// Must be called before app.ready so Chromium treats ext:// as a secure standard
// origin — without this, service worker storage and fetch() fail inside WebContentsViews.
protocol.registerSchemesAsPrivileged([
  {
    scheme: 'ext',
    privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true },
  },
])

app.whenReady().then(async () => {
  logger.info('App ready', { version: app.getVersion() })

  const userData = app.getPath('userData')
  await initAppDb(userData)
  await runLegacyMigration(userData, getAppDb())

  // Serve extension renderer files via ext://<id>/<relPath>.
  // Only files within the extension's registered directory are accessible.
  // Extension WebContentsViews use the 'ext-views' in-memory partition to
  // avoid service-worker storage conflicts with the main window session.
  // Both sessions need the handler registered.
  const handleExtProtocol = async (request: Request): Promise<Response> => {
    const url = new URL(request.url)
    const extensionId = url.hostname
    const relPath = url.pathname.slice(1)
    const dir = extensionHost.getExtensionDirectory(extensionId)
    if (!dir || !relPath) return new Response('Not found', { status: 404 })
    const fullPath = join(dir, relPath).replace(/\\/g, '/')
    if (!fullPath.startsWith(dir.replace(/\\/g, '/'))) {
      return new Response('Forbidden', { status: 403 })
    }
    let res: Response
    try {
      res = await net.fetch(`file://${fullPath}`)
    } catch {
      return new Response(`Not found: ${relPath}`, { status: 404 })
    }
    if (!res.ok) return new Response(`Not found: ${relPath}`, { status: res.status })
    const headers: Record<string, string> = { 'Cache-Control': 'no-store', Pragma: 'no-cache' }
    res.headers.forEach((value, key) => {
      headers[key] = value
    })
    return new Response(res.body, { status: res.status, headers })
  }

  session.defaultSession.protocol.handle('ext', handleExtProtocol)
  session.fromPartition('ext-views').protocol.handle('ext', handleExtProtocol)

  registerWorkspaceHandlers()
  registerTerminalHandlers(ptyManager, () => mainWindow)
  registerSettingsHandlers()
  registerExtensionHandlers(extensionHost, (channel, data) =>
    viewHost?.broadcastToAll(channel, data)
  )

  ipcMain.handle(
    'extension:update-panel-bounds',
    async (_event, { extensionId, viewParam, bounds, visible }) => {
      if (viewHost && !viewHost.hasView(extensionId, viewParam)) {
        const ext = extensionHost.listExtensions().find((e) => e.id === extensionId)
        if (ext) await viewHost.createView(ext, viewParam)
      }
      viewHost?.handleBoundsUpdate(extensionId, viewParam, bounds, visible)
    }
  )

  ipcMain.on('workspace:active-changed', (_event, data) => {
    viewHost?.broadcastToAll('workspace:changed', data)
  })
  registerGitHandlers()
  registerShellHandlers()
  registerFsHandlers(() => mainWindow)
  registerLogHandlers()
  registerNotificationHandlers()
  registerMetricsHandlers(ptyManager)
  registerDbIpcHandlers()
  registerDialogHandlers()
  registerAppHandlers()

  extensionHost.setDeps({
    ptyManager,
    db: getAppDb(),
    broadcastToWindows: (channel, data) => mainWindow?.webContents.send(channel, data),
    bridge: {
      invokeRegistry: ipcInvokeRegistry,
      sendRegistry: ipcSendRegistry,
      eventBus: bridgeEventBus,
    },
  })

  await extensionHost.loadAll()
  await extensionHost.loadBundledExtensions(join(__dirname, '../../extensions'))
  // Build menu after extensions load so extension-contributed items are included from the start
  setupMenu()

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

// A rejection in the startup chain above (e.g. database or extension init
// failure) would otherwise leave the process alive with no window ever
// created — a blank, unquittable app. Surface it loudly and exit instead of
// bricking silently.
process.on('unhandledRejection', (reason) => {
  if (mainWindow) return
  const message = reason instanceof Error ? (reason.stack ?? reason.message) : String(reason)
  logger.error('Fatal error during app startup', { message })
  dialog.showErrorBox('Terminator failed to start', message)
  app.exit(1)
})

app.on('before-quit', async (event) => {
  event.preventDefault()
  app.isQuitting = true
  await extensionHost.unloadAll()
  await ptyManager.killAll()
  await closeAppDb()
  app.exit(0)
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
