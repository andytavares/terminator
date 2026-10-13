import './claim-profile.js'
import { onChannel } from './ipc/channel-registrar.js'
import { registerAppInfoHandlers, registerDialogHandlers } from './ipc/app.ipc.js'
import { app, BrowserWindow, dialog, Menu, shell, net, session, protocol } from 'electron'
import { join } from 'path'
import {
  registerWorkspaceHandlers,
  setActiveWorkspaceContext,
  type ActiveWorkspaceContext,
} from './ipc/workspace.ipc.js'
import { registerTerminalHandlers, sendToRenderer } from './ipc/terminal.ipc.js'
import { OutputRelay } from './terminal/output-relay.js'
import { registerSettingsHandlers } from './ipc/settings.ipc.js'
import { registerExtensionHandlers } from './ipc/extension.ipc.js'
import { registerGitHandlers } from './ipc/git.ipc.js'
import { registerIntegrationsHandlers } from './ipc/integrations.ipc.js'
import { migrateLegacyCredentials } from './integrations/tracker-store.js'
import { loadLinks, registerLinkGarbageCollection } from './integrations/issue-link-store.js'
import { loadRecords, markClosed, sweepOpenRecords } from './sessions/session-record-store.js'
import { closeSessionsOfDeletedProjects } from './terminal/project-sessions.js'
import { installCaptureScript, installUserHook } from './agents/agent-session-hook.js'
import { startAgentSessionWatcher } from './agents/agent-session-watcher.js'
import { makeSnapshotFor } from './sessions/session-snapshot.js'
import { registerSessionRecordsHandlers } from './ipc/session-records.ipc.js'
import { ensureHookScript } from './integrations/context-sync.js'
import { registerShellHandlers } from './ipc/shell.ipc.js'
import { startAdoptingLoginShellPath } from './shell/login-shell-path.js'
import { stopRunningCommands } from './shell/command-runner.js'
import { registerEditorHandlers } from './ipc/editor.ipc.js'
import { registerFsHandlers } from './ipc/fs.ipc.js'
import { registerLogHandlers } from './ipc/log.ipc.js'
import { registerNotificationHandlers } from './ipc/notification.ipc.js'
import { registerMetricsHandlers } from './ipc/metrics.ipc.js'
import { registerDbIpcHandlers } from './ipc/db.ipc.js'
import { PtyManager } from './terminal/pty-manager.js'
import { ExtensionHost } from './extensions/extension-host.js'
import { ExtensionHostProcess, spawnUtilityHost } from './extensions/host/host-process.js'
import { trackerAbilitiesOf, workspacesOf } from './extensions/host/main-snapshot.js'
import {
  extensionSettingsSnapshot,
  onExtensionSettingsChanged,
} from './storage/extension-settings-store.js'
import { onWorkspacesChanged } from './storage/workspace-store.js'
import { ExtensionViewHost } from './extensions/extension-view-host.js'
import { routeExtensionExitRequest } from './extensions/extension-exit.js'
import { logger } from './logger.js'
import { sendToWindow } from './safe-send.js'
import { buildWindowMenu } from './window-menu.js'
import { bridgeEventBus } from './remote/bridge-event-bus.js'
import { ipcInvokeRegistry, ipcSendRegistry } from './remote/ipc-registry.js'
import { initAppDb, getAppDb, closeAppDb } from './db/index.js'
import { legacyImportPending, importLegacyDatabase } from './db/legacy-pglite-import.js'
import {
  createExtensionAPI,
  listNativeViewMenuItems,
  getPanelMenuItemId,
  setMenuRebuildCallback,
  type ExtensionAPIDeps,
} from './extensions/api.js'

// All IPC channel registration goes through channel-registrar.ts (core) or
// api.ipc.registerHandler (extensions), both of which record the bridge
// registry entry and its remote-access declaration explicitly. ipcMain is
// never monkey-patched.

// Set by before-quit so the macOS close handler lets the window go.
let isQuitting = false
let mainWindow: BrowserWindow | null = null
let viewHost: ExtensionViewHost | null = null
const ptyManager = new PtyManager()
// Reads core state the way an extension's API does, for the extension host's snapshot.
const coreView = createExtensionAPI('terminator.extension-host')
/** Extension backends run in one utilityProcess (ADR 094), started on the first activation. */
const extensionHostProcess: ExtensionHostProcess = new ExtensionHostProcess({
  spawn: spawnUtilityHost(join(__dirname, 'extension-host.js')),
  snapshot: () => ({
    databasePath: join(app.getPath('userData'), 'app.sqlite'),
    paths: { app: app.getAppPath(), userData: app.getPath('userData') },
    settings: extensionSettingsSnapshot(),
    workspaces: workspacesOf(coreView.workspace),
    trackers: trackerAbilitiesOf(coreView.issues),
  }),
  apiFor: (id) => extensionHost.apiOf(id),
  onBackendsFailed: (ids, message) => extensionHost.failHostedBackends(ids, message),
  log: (message) => logger.warn(message),
})
const extensionHost: ExtensionHost = new ExtensionHost(extensionHostProcess)

/** Returning from another app lands the caret where the user left it. Electron restores focus to
 * the window's own webContents at most, so the focused surface is recorded on blur (by 'focus'
 * Electron has overwritten it) and focused again on focus. */
function restoreFocusOnReturn(win: BrowserWindow): void {
  win.webContents.on('focus', () => viewHost?.noteFocused(null))
  win.on('blur', () => viewHost?.captureFocusTarget())
  win.on('focus', () => {
    // Deferred a tick so Electron's own RestoreFocus runs first and does not
    // immediately undo the restore.
    setImmediate(() => viewHost?.restoreFocus())
  })
}

function loadRenderer(win: BrowserWindow): void {
  if (process.env.NODE_ENV === 'development' || process.env['ELECTRON_RENDERER_URL']) {
    win.loadURL(process.env['ELECTRON_RENDERER_URL'] || 'http://localhost:5173')
  } else {
    win.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

/** Forwards every main→renderer push to browser bridge clients and extension views. */
function relayPushes(win: BrowserWindow): void {
  const _origSend = win.webContents.send.bind(win.webContents)
  win.webContents.send = (channel: string, ...args: unknown[]) => {
    _origSend(channel, ...args)
    bridgeEventBus.emit(channel, ...args)
    // Relay to extension WebContentsViews so extension renderers receive push events
    // (terminal: is high-frequency; workspace:changed is relayed separately below)
    if (!channel.startsWith('terminal:') && channel !== 'workspace:changed') {
      viewHost?.broadcastToAll(channel, args[0] as unknown)
    }
  }
}

function openExternally(url: string): void {
  if (url.startsWith('http://') || url.startsWith('https://')) {
    shell.openExternal(url).catch(() => {})
  }
}

/** Redirect external http(s) link clicks and window.open() calls to the system browser. Non-http
 * URLs (e.g. same-origin navigations) are denied without opening externally. */
function openLinksInBrowser(win: BrowserWindow): void {
  win.webContents.setWindowOpenHandler(({ url }) => {
    openExternally(url)
    return { action: 'deny' }
  })
  win.webContents.on('will-navigate', (event, url) => {
    if (url !== win.webContents.getURL()) {
      event.preventDefault()
      openExternally(url)
    }
  })
}

/** On macOS, hide instead of destroy so PTY sessions and renderer state survive. Full quit
 * (Cmd+Q / right-click Quit) still goes through before-quit → killAll(). */
function handleWindowClose(win: BrowserWindow): void {
  if (process.platform === 'darwin') {
    win.on('close', (event) => {
      if (!isQuitting) {
        event.preventDefault()
        mainWindow?.hide()
      }
    })
  } else {
    win.on('closed', () => {
      mainWindow = null
    })
  }
}

function createWindow(): void {
  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      preload: join(__dirname, '../preload/index.js'),
      webviewTag: true,
    },
  })
  mainWindow = win
  viewHost = new ExtensionViewHost(win, join(__dirname, '../preload/webview.js'))
  restoreFocusOnReturn(win)
  loadRenderer(win)
  relayPushes(win)
  openLinksInBrowser(win)
  handleWindowClose(win)
}

function openAbout(): void {
  mainWindow?.webContents.send('menu:open-about')
}

function extensionViewMenuItems(): Electron.MenuItemConstructorOptions[] {
  return listNativeViewMenuItems().map(
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
}

function buildViewSubmenu(): Electron.MenuItemConstructorOptions[] {
  const extItems = extensionViewMenuItems()
  return [
    {
      label: 'Toggle Sidebar',
      accelerator: 'CmdOrCtrl+B',
      click: () => mainWindow?.webContents.send('menu:toggle-sidebar'),
    },
    { type: 'separator' },
    ...extItems,
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
}

/** The application menu macOS shows under the app's name; nothing elsewhere. */
function appNameMenu(): Electron.MenuItemConstructorOptions[] {
  if (process.platform !== 'darwin') return []
  return [
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
  ]
}

function helpMenu(): Electron.MenuItemConstructorOptions {
  return {
    label: 'Help',
    submenu: [
      { label: `About ${app.getName()}`, click: openAbout },
      { type: 'separator' },
      {
        label: 'View on GitHub',
        click: () => void shell.openExternal('https://github.com/anthropics/terminator'),
      },
    ],
  }
}

function setupMenu(): void {
  const template: Electron.MenuItemConstructorOptions[] = [
    ...appNameMenu(),
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
    buildWindowMenu((channel) => mainWindow?.webContents.send(channel)),
    helpMenu(),
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

  registerAppInfoHandlers()
}

app.on('second-instance', () => {
  if (!mainWindow) return
  if (mainWindow.isMinimized()) mainWindow.restore()
  mainWindow.show()
  mainWindow.focus()
})

// Must be called before app.ready so Chromium treats ext:// as a secure standard
// origin — without this, service worker storage and fetch() fail inside WebContentsViews.
protocol.registerSchemesAsPrivileged([
  {
    scheme: 'ext',
    privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true },
  },
])

/** Serves extension renderer files via ext://<id>/<relPath>. Only files within the extension's
 * registered directory are accessible. */
async function serveExtensionFile(request: Request): Promise<Response> {
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

/** Extension WebContentsViews use the 'ext-views' in-memory partition to avoid service-worker
 * storage conflicts with the main window session. Both sessions need the handler registered. */
function registerExtProtocol(): void {
  session.defaultSession.protocol.handle('ext', serveExtensionFile)
  session.fromPartition('ext-views').protocol.handle('ext', serveExtensionFile)
}

/** What the extension views send main: insets, the theme, a request to exit, the active workspace. */
function registerExtensionViewChannels(): void {
  onChannel('extension:set-bottom-inset', (_event, { inset }: { inset: number }) => {
    viewHost?.setBottomInset(inset)
  })
  onChannel('extension:set-left-inset', (_event, { inset }: { inset: number }) => {
    viewHost?.setLeftInset(inset)
  })
  onChannel('extension:set-theme', (_event, { theme }: { theme: 'dark' | 'light' }) => {
    viewHost?.setTheme(theme)
  })
  // Sent by the double-Escape gesture in the extension webview preload. The
  // extension view is its own webContents, so the host renderer never sees the
  // keystroke — main attributes it to a surface and relays the exit.
  onChannel('extension:request-exit', (event) => {
    if (!viewHost || !mainWindow || mainWindow.isDestroyed()) return
    routeExtensionExitRequest(event.sender, {
      findViewByWebContents: (wc) => viewHost!.findViewByWebContents(wc),
      listExtensions: () => extensionHost.listAll(),
      focusMainRenderer: () => {
        viewHost!.noteFocused(null)
        mainWindow!.webContents.focus()
      },
      send: (channel, payload) => mainWindow!.webContents.send(channel, payload),
    })
  })
  onChannel('workspace:active-changed', (_event, data: ActiveWorkspaceContext) => {
    setActiveWorkspaceContext(data)
    viewHost?.broadcastToAll('workspace:changed', data)
  })
}

/** Workspaces, terminals, settings, extensions, git, integrations and session records. */
function registerSessionHandlers(): OutputRelay {
  registerWorkspaceHandlers()
  const terminalRelay = new OutputRelay(
    ptyManager,
    sendToRenderer(() => mainWindow)
  )
  registerTerminalHandlers(ptyManager, () => mainWindow, terminalRelay)
  registerSettingsHandlers()
  registerExtensionHandlers(
    extensionHost,
    (channel, data) => viewHost?.broadcastToAll(channel, data),
    () => viewHost
  )
  registerExtensionViewChannels()
  registerGitHandlers()
  registerIntegrationsHandlers(() => mainWindow)
  registerSessionRecordsHandlers(() => mainWindow)
  return terminalRelay
}

/** Issue links, session records and the agent session hook, read and installed in the background. */
function startIntegrationsAndRecords(): void {
  // The operator already gave these to the SpecKit Pilot extension; asking
  // again because the code moved would be the migration failing at the only
  // thing it exists to do. Best-effort — a failure here never blocks startup.
  void migrateLegacyCredentials()
  // Links are read once and held in memory; every reader of them is on a hot
  // path (the sidebar draws a badge per project) and none can await a file.
  void loadLinks()
  registerLinkGarbageCollection()
  closeSessionsOfDeletedProjects({ pty: ptyManager, markClosed })
  // Nothing can be open at startup: sessions die with the app, so whatever the
  // last run left open is closed at its last update before anyone reads it.
  void loadRecords()
    .then(sweepOpenRecords)
    .then(() => startAgentSessionWatcher({ snapshotFor: makeSnapshotFor(ptyManager) }))
    .catch((error) =>
      logger.error('agent session capture failed to start', { error: String(error) })
    )
  // Lets an agent — including one the operator starts by hand — report the
  // conversation it is having, so the session can be resumed later (ADR 055).
  void installCaptureScript(join(app.getPath('userData'), 'integrations'))
    .then((scriptPath) => installUserHook({ execPath: process.execPath, scriptPath }))
    .catch((error) =>
      logger.error('could not install the agent session hook', { error: String(error) })
    )
  // Written at startup rather than shipped beside the bundle: a loose script
  // survives development and vanishes from the packaged app (ADR-026).
  void ensureHookScript()
}

/** Shell, editor, files, logging, notifications, metrics, the database, dialogs and the app. */
function registerToolHandlers(): void {
  registerShellHandlers()
  registerEditorHandlers()
  registerFsHandlers(() => mainWindow)
  registerLogHandlers()
  registerNotificationHandlers()
  registerMetricsHandlers(ptyManager)
  registerDbIpcHandlers()
  registerDialogHandlers(() => mainWindow)
  registerAppHandlers()
}

function broadcastToWindows(channel: string, data: unknown): void {
  // Extension pop-outs are BrowserWindows too and get every push, or they drift from the docked
  // panel. Guarded: an extension's PTY broadcasts every chunk, and outlives the window that opened
  // it.
  for (const win of BrowserWindow.getAllWindows()) {
    sendToWindow(win, channel, data)
  }
  // The main window's send is patched above to relay to extension WebContentsViews for every
  // channel except the two it filters out — only relay explicitly when that patch did not already
  // do it, or the views would receive the same push twice.
  const relayedByMainWindow =
    !!mainWindow &&
    !mainWindow.isDestroyed() &&
    !mainWindow.webContents.isDestroyed() &&
    !channel.startsWith('terminal:') &&
    channel !== 'workspace:changed'
  if (!relayedByMainWindow) viewHost?.broadcastToAll(channel, data)
}

function extensionDeps(terminalRelay: OutputRelay, userData: string): ExtensionAPIDeps {
  return {
    ptyManager,
    terminalRelay,
    db: getAppDb(),
    paths: { app: app.getAppPath(), userData },
    broadcastToWindows,
    focusExtensionView: (extId, viewParam) => viewHost?.focusView(extId, viewParam),
    bridge: {
      invokeRegistry: ipcInvokeRegistry,
      sendRegistry: ipcSendRegistry,
      eventBus: bridgeEventBus,
    },
  }
}

/** The renderer lists the extensions (complete as soon as start is called) and each extension
 * view waits for its own backend, so none of this holds the window back. The legacy import
 * needs every extension's tables to exist. */
function startExtensions(
  loginShellPath: Promise<void>,
  importLegacy: boolean,
  userData: string
): void {
  extensionHost
    .startAll({
      bundledDirectory: join(__dirname, '../../extensions'),
      beforeActivation: loginShellPath,
      afterActivation: importLegacy ? () => importLegacyDatabase(userData, getAppDb()) : undefined,
    })
    .then(setupMenu)
    .catch((error) => logger.error('extension startup failed', { error: String(error) }))
}

app.whenReady().then(async () => {
  logger.info('App ready', { version: app.getVersion() })
  // Slow (a login shell starts) and only extensions need its result, so it runs
  // while the window and the database come up.
  const loginShellPath =
    process.platform === 'darwin' ? startAdoptingLoginShellPath() : Promise.resolve()

  const userData = app.getPath('userData')
  const importLegacy = legacyImportPending(userData)
  initAppDb(userData)
  registerExtProtocol()

  const terminalRelay = registerSessionHandlers()
  startIntegrationsAndRecords()
  registerToolHandlers()
  extensionHost.setDeps(extensionDeps(terminalRelay, userData))

  // The extension host's synchronous getters read these; main pushes every change.
  // Views re-read on extension:settings-changed, so a change made in Settings applies at once;
  // it carries the workspace whose own value changed, or null for a global value.
  onExtensionSettingsChanged((change) => {
    extensionHostProcess.pushSettings(extensionSettingsSnapshot())
    broadcastToWindows('extension:settings-changed', change)
  })
  onWorkspacesChanged(() => extensionHostProcess.pushWorkspaces(workspacesOf(coreView.workspace)))
  setupMenu()
  createWindow()

  app.on('activate', () => {
    if (mainWindow) {
      mainWindow.show()
    } else {
      createWindow()
    }
  })
  startExtensions(loginShellPath, importLegacy, userData)
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
  isQuitting = true
  await extensionHost.unloadAll()
  extensionHostProcess.stopHost()
  // After the extensions, which start most of them: a git or gh command still
  // running, and whatever it started, would outlive the app.
  stopRunningCommands()
  await ptyManager.killAll()
  closeAppDb()
  app.exit(0)
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
