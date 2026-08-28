import { handleChannel, onChannel } from './ipc/channel-registrar.js'
import { app, BrowserWindow, dialog, Menu, shell, net, session, protocol } from 'electron'
import { join } from 'path'
import { registerWorkspaceHandlers } from './ipc/workspace.ipc.js'
import { registerTerminalHandlers } from './ipc/terminal.ipc.js'
import { registerSettingsHandlers } from './ipc/settings.ipc.js'
import { registerExtensionHandlers } from './ipc/extension.ipc.js'
import { registerGitHandlers } from './ipc/git.ipc.js'
import { registerIntegrationsHandlers } from './ipc/integrations.ipc.js'
import { migrateLegacyCredentials } from './integrations/tracker-store.js'
import { loadLinks, registerLinkGarbageCollection } from './integrations/issue-link-store.js'
import { ensureHookScript } from './integrations/context-sync.js'
import { registerShellHandlers } from './ipc/shell.ipc.js'
import { registerFsHandlers } from './ipc/fs.ipc.js'
import { registerLogHandlers } from './ipc/log.ipc.js'
import { registerNotificationHandlers } from './ipc/notification.ipc.js'
import { registerMetricsHandlers } from './ipc/metrics.ipc.js'
import { registerDbIpcHandlers } from './ipc/db.ipc.js'
import { PtyManager } from './terminal/pty-manager.js'
import { ExtensionHost } from './extensions/extension-host.js'
import { ExtensionViewHost } from './extensions/extension-view-host.js'
import { routeExtensionExitRequest } from './extensions/extension-exit.js'
import { logger } from './logger.js'
import { sendToWindow } from './safe-send.js'
import { bridgeEventBus } from './remote/bridge-event-bus.js'
import { ipcInvokeRegistry, ipcSendRegistry } from './remote/ipc-registry.js'
import { initAppDb, getAppDb, closeAppDb } from './db/index.js'
import { runLegacyMigration } from './db/migrate.js'
import {
  listNativeViewMenuItems,
  getPanelMenuItemId,
  setMenuRebuildCallback,
} from './extensions/api.js'

// All IPC channel registration goes through channel-registrar.ts (core) or
// api.ipc.registerHandler (extensions), both of which record the bridge
// registry entry and its remote-access declaration explicitly. ipcMain is
// never monkey-patched.

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

  // Returning to Terminator from another app must land the caret back where the
  // user left it — no second click. Electron restores focus to the window's own
  // webContents (and on macOS not even that), so the focused surface is
  // snapshotted on blur and re-focused explicitly on focus. The snapshot has to
  // happen on blur: by 'focus' time Electron has already overwritten the record.
  mainWindow.webContents.on('focus', () => viewHost?.noteFocused(null))
  mainWindow.on('blur', () => viewHost?.captureFocusTarget())
  mainWindow.on('focus', () => {
    // Deferred a tick so Electron's own RestoreFocus runs first and does not
    // immediately undo the restore.
    setImmediate(() => viewHost?.restoreFocus())
  })

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
    // Relay to extension WebContentsViews so extension renderers receive push events
    // (terminal: is high-frequency; workspace:changed is relayed separately below)
    if (!channel.startsWith('terminal:') && channel !== 'workspace:changed') {
      viewHost?.broadcastToAll(channel, args[0] as unknown)
    }
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

  const extItems = listNativeViewMenuItems().map(
    (item) =>
      ({
        id: item.id,
        label: item.label,
        accelerator: item.accelerator,
        type: item.type,
        checked: false,
        click: item.onClick,
      }) as Electron.MenuItemConstructorOptions
  )

  const tail: Electron.MenuItemConstructorOptions[] = [
    ...(extItems.length > 0 ? [{ type: 'separator' as const }] : []),
    {
      label: 'Open Settings',
      accelerator: 'CmdOrCtrl+,',
      click: () => mainWindow?.webContents.send('menu:open-settings'),
    },
    { type: 'separator' },
    {
      label: 'Open Extension DevTools',
      accelerator: 'CmdOrCtrl+Shift+I',
      click: () => viewHost?.openDevToolsForAll(),
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
  onChannel(
    'menu:set-panel-checked',
    (_event, { panelId, open }: { panelId: string; open: boolean }) => {
      const menuItemId = getPanelMenuItemId(panelId)
      if (menuItemId) {
        const menuItem = Menu.getApplicationMenu()?.getMenuItemById(menuItemId)
        if (menuItem) menuItem.checked = open
      }
    }
  )

  handleChannel('app:get-info', () => ({
    appName: app.getName(),
    version: app.getVersion(),
    electronVersion: process.versions.electron,
    nodeVersion: process.versions.node,
    chromeVersion: process.versions.chrome,
    platform: process.platform,
    // Lets the renderer show `~/repos/app` instead of an absolute path that
    // wraps a sidebar row onto two lines.
    homeDir: app.getPath('home'),
  }))
}

function registerDialogHandlers(): void {
  handleChannel('dialog:open-directory', async () => {
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

  handleChannel(
    'extension:update-panel-bounds',
    async (_event, { extensionId, viewParam, bounds, visible, repoRoot }) => {
      await viewHost?.updatePanelBounds(
        () => extensionHost.listExtensions().find((e) => e.id === extensionId),
        extensionId,
        viewParam,
        bounds,
        visible,
        repoRoot
      )
    }
  )

  onChannel('extension:set-bottom-inset', (_event, { inset }: { inset: number }) => {
    viewHost?.setBottomInset(inset)
  })

  onChannel('extension:set-left-inset', (_event, { inset }: { inset: number }) => {
    viewHost?.setLeftInset(inset)
  })

  // Sent by the double-Escape gesture in the extension webview preload. The
  // extension view is its own webContents, so the host renderer never sees the
  // keystroke — main attributes it to a surface and relays the exit.
  onChannel('extension:request-exit', (event) => {
    if (!viewHost || !mainWindow || mainWindow.isDestroyed()) return
    routeExtensionExitRequest(event.sender, {
      findViewByWebContents: (wc) => viewHost!.findViewByWebContents(wc),
      listExtensions: () => extensionHost.listExtensions(),
      focusMainRenderer: () => {
        viewHost!.noteFocused(null)
        mainWindow!.webContents.focus()
      },
      send: (channel, payload) => mainWindow!.webContents.send(channel, payload),
    })
  })

  onChannel('workspace:active-changed', (_event, data) => {
    viewHost?.broadcastToAll('workspace:changed', data)
  })
  registerGitHandlers()
  registerIntegrationsHandlers(() => mainWindow)
  // The operator already gave these to the SpecKit Pilot extension; asking
  // again because the code moved would be the migration failing at the only
  // thing it exists to do. Best-effort — a failure here never blocks startup.
  void migrateLegacyCredentials()
  // Links are read once and held in memory; every reader of them is on a hot
  // path (the sidebar draws a badge per project) and none can await a file.
  void loadLinks()
  registerLinkGarbageCollection()
  // Written at startup rather than shipped beside the bundle: a loose script
  // survives development and vanishes from the packaged app (ADR-026).
  void ensureHookScript()
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
    broadcastToWindows: (channel, data) => {
      // Auxiliary windows (extension pop-outs) are real BrowserWindows and must
      // receive pushes too, otherwise a pop-out and the docked panel drift apart.
      // Guarded: a PTY opened through the extension API broadcasts on every
      // chunk, and keeps running after the window that opened it has closed.
      for (const win of BrowserWindow.getAllWindows()) {
        sendToWindow(win, channel, data)
      }
      // The main window's send is patched above to relay to extension
      // WebContentsViews for every channel except the two it filters out — only
      // relay explicitly when that patch did not already do it, or the views
      // would receive the same push twice.
      const relayedByMainWindow =
        !!mainWindow &&
        !mainWindow.isDestroyed() &&
        !mainWindow.webContents.isDestroyed() &&
        !channel.startsWith('terminal:') &&
        channel !== 'workspace:changed'
      if (!relayedByMainWindow) viewHost?.broadcastToAll(channel, data)
    },
    focusExtensionView: (extId, viewParam) => viewHost?.focusView(extId, viewParam),
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
