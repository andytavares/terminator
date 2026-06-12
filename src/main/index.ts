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
import { createRemoteServer, type RemoteServerHandle } from './remote/remote-server.js'
import {
  registerRemoteHandlers,
  sendStatus,
  sendLog,
  ensurePasswordHash,
} from './ipc/remote.ipc.js'
import { NgrokManager } from './remote/ngrok-manager.js'
import { getGlobalSettings, updateGlobalSettings } from './storage/settings-store.js'
import { networkInterfaces } from 'os'
import { bridgeEventBus } from './remote/bridge-event-bus.js'
import { ipcInvokeRegistry, ipcSendRegistry } from './remote/ipc-registry.js'

// Intercept ipcMain.handle/on to capture handlers into the bridge registry
// so the remote bridge can dispatch them without circular imports.
type IpcHandler = (event: Electron.IpcMainInvokeEvent, payload: unknown) => unknown
type IpcSendHandler = (event: Electron.IpcMainEvent, payload: unknown) => void

const _origHandle = ipcMain.handle.bind(ipcMain)
const _origOn = ipcMain.on.bind(ipcMain)
// @ts-expect-error - patch to intercept all handler registrations
ipcMain.handle = (channel: string, fn: IpcHandler) => {
  ipcInvokeRegistry.set(channel, fn)
  return _origHandle(channel, fn)
}
// @ts-expect-error - patch to intercept fire-and-forget handlers
ipcMain.on = (channel: string, fn: IpcSendHandler) => {
  ipcSendRegistry.set(channel, fn)
  return _origOn(channel, fn)
}

declare module 'electron' {
  interface App {
    isQuitting?: boolean
  }
}

let mainWindow: BrowserWindow | null = null
const ptyManager = new PtyManager()
const extensionHost = new ExtensionHost()
let remoteServer: RemoteServerHandle | null = null
const ngrokManager = new NgrokManager()
// Serialises start/stop calls so rapid toggling cannot cause concurrent operations
let remoteControlQueue: Promise<void> = Promise.resolve()

function getLanUrl(port: number): string {
  const ifaces = networkInterfaces()
  for (const iface of Object.values(ifaces)) {
    for (const addr of iface ?? []) {
      if (addr.family === 'IPv4' && !addr.internal) {
        return `http://${addr.address}:${port}`
      }
    }
  }
  return `http://localhost:${port}`
}

async function startRemoteControl(): Promise<void> {
  // Stop any running instance first to avoid EADDRINUSE on rapid re-enable
  if (remoteServer) {
    await stopRemoteControl()
  }
  const settings = getGlobalSettings()
  const { port } = settings.remoteControl
  if (!settings.remoteControl.passwordHash) {
    await ensurePasswordHash('', updateGlobalSettings)
    sendLog(
      mainWindow,
      'info',
      'Remote Control: generated initial password — check Settings to view it'
    )
  }
  try {
    remoteServer = await createRemoteServer({
      port,
      ptyManager,
      deps: { getGlobalSettings, updateGlobalSettings },
      getWindow: () => mainWindow,
    })
    await remoteServer.start()
    sendLog(mainWindow, 'info', `Remote Control: server started on port ${port}`)
    sendStatus(mainWindow, { enabled: true, port, lanUrl: getLanUrl(port), publicUrl: null })

    if (NgrokManager.isInstalled()) {
      try {
        const ngrokAuthToken = settings.remoteControl.ngrokAuthToken || undefined
        sendLog(
          mainWindow,
          'info',
          `Remote Control: starting ngrok ${ngrokAuthToken ? 'with auth token' : 'WITHOUT auth token (add one in Settings)'}`
        )
        const publicUrl = await ngrokManager.start(port, ngrokAuthToken)
        // Register crash handler only after tunnel is confirmed — prevents false "exited unexpectedly"
        // messages when ngrok crashes during the polling/startup phase
        ngrokManager.setOnCrash(() => {
          sendLog(mainWindow, 'error', 'Remote Control: ngrok process exited unexpectedly')
          mainWindow?.webContents.send('remote:tunnel-disconnected')
          sendStatus(mainWindow, { enabled: true, port, publicUrl: null, lanUrl: getLanUrl(port) })
        })
        sendLog(mainWindow, 'info', `Remote Control: tunnel established at ${publicUrl}`)
        sendStatus(mainWindow, {
          enabled: true,
          port,
          publicUrl,
          lanUrl: getLanUrl(port),
          ngrokInstalled: true,
          ngrokError: null,
        })
      } catch (err) {
        const errMsg = String(err)
        sendLog(mainWindow, 'warn', `Remote Control: ngrok failed to start: ${errMsg}`)
        const needsAuth = !settings.remoteControl.ngrokAuthToken
        sendStatus(mainWindow, {
          enabled: true,
          port,
          publicUrl: null,
          lanUrl: getLanUrl(port),
          ngrokInstalled: true,
          ngrokError: needsAuth ? 'ngrok requires an auth token — add yours in Settings' : errMsg,
        })
      }
    } else {
      sendLog(mainWindow, 'warn', 'Remote Control: ngrok not installed')
      sendStatus(mainWindow, {
        enabled: true,
        port,
        publicUrl: null,
        lanUrl: getLanUrl(port),
        ngrokInstalled: false,
      })
    }
  } catch (err) {
    sendLog(mainWindow, 'error', `Remote Control: failed to start server: ${String(err)}`)
    sendStatus(mainWindow, { enabled: false, error: 'START_FAILED' })
  }
}

async function stopRemoteControl(): Promise<void> {
  ngrokManager.stop()
  if (remoteServer) {
    await remoteServer.stop()
    remoteServer = null
  }
  sendLog(mainWindow, 'info', 'Remote Control: stopped')
  sendStatus(mainWindow, { enabled: false })
}

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
  registerSettingsHandlers((enabled) => {
    remoteControlQueue = remoteControlQueue
      .then(() => (enabled ? startRemoteControl() : stopRemoteControl()))
      .catch(() => {})
    return remoteControlQueue
  })
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

  registerRemoteHandlers(
    () => mainWindow,
    async () => {
      if (remoteServer) await stopRemoteControl()
      await startRemoteControl()
    },
    {
      updateGlobalSettings,
      disconnectAllClients: () => remoteServer?.inject && undefined,
    }
  )

  const settings = getGlobalSettings()
  if (settings.remoteControl.enabled) {
    remoteControlQueue = remoteControlQueue
      .then(() => startRemoteControl())
      .catch((err) => logger.error('Remote Control: auto-start failed', { err }))
  }

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
  await stopRemoteControl()
  await ptyManager.killAll()
  app.exit(0)
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
