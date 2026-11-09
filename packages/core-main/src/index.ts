import './claim-profile.js'
import { onChannel } from './ipc/channel-registrar.js'
import { registerAppInfoHandlers, registerDialogHandlers } from './ipc/app.ipc.js'
import { app, autoUpdater, BrowserWindow, dialog, Menu, shell, session, protocol } from 'electron'
import { enterBackgroundMode, revealWindow, newWindow } from './background-mode.js'
import {
  checkForUpdatesNow,
  checkForUpdatesQuietly,
  downloadedUpdate,
  installUpdateNow,
  startAppUpdates,
} from './app-updater.js'
import { announceWindowReadiness, exposeReadinessToTests } from './e2e-readiness.js'
import { join } from 'path'
import { buildHelpMenu, buildViewMenu, tickPanelItem } from './app-menu.js'
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
import { loadLinks, registerLinkGarbageCollection } from './integrations/issue-link-store.js'
import {
  configureRetention,
  loadRecords,
  markClosed,
  startPurging,
  sweepOpenRecords,
} from './sessions/session-record-store.js'
import { closeSessionsOfDeletedProjects } from './terminal/project-sessions.js'
import { installUserHooks } from './agents/claude-hook.js'
import { startAgentSessionWatcher } from './agents/agent-session-watcher.js'
import { makeSnapshotFor } from './sessions/session-snapshot.js'
import { registerSessionRecordsHandlers } from './ipc/session-records.ipc.js'
import { registerAgentAskHandlers } from './ipc/agent-ask.ipc.js'
import { registerAgentTurnHandlers } from './ipc/agent-turn.ipc.js'
import { registerAgentsHandlers } from './ipc/agents.ipc.js'
import { disposeAgentService, startAgentService } from './agents/acp/agent-service-instance.js'
import { registerTaskHandlers } from './ipc/task.ipc.js'
import { loadTasks } from './tasks/task-store.js'
import { registerAttentionHandlers } from './ipc/attention.ipc.js'
import { registerUsageHandlers } from './ipc/usage.ipc.js'
import { initUsageStore, getUsageStore, closeUsageStore } from './usage/usage-store.js'
import { CORE_FEATURES } from '../../core-shared/src/usage/core-features.js'
import { loadAttentionLog } from './home/attention-log.js'
import { startAskWatcher } from './agents/ask-watcher.js'
import { registerAgentUsageHandlers } from './ipc/agent-usage.ipc.js'
import { registerThreadSummaryHandler } from './ipc/thread-summary.ipc.js'
import { registerHomeFeedHandlers } from './ipc/home-feed.ipc.js'
import { registerScheduleHandlers } from './ipc/schedules.ipc.js'
import { ensureHookScript } from './integrations/context-sync.js'
import { startMcpServer } from './mcp/mcp-server.js'
import { installRelayScript } from './mcp/relay-script.js'
import { manifestTools } from './mcp/manifest-tools.js'
import { alertTool } from './mcp/alert-tool.js'
import { mcpSocketPath } from './mcp/socket-path.js'
import { moveSessionTool } from './mcp/move-session.js'
import { registerRendererTools, rendererTools } from './mcp/renderer-tools.js'
import { appTools } from './mcp/app-tools.js'
import { registerWithClaude } from './mcp/registration.js'
import { registerClaudeCodeHandlers } from './ipc/claude-code.ipc.js'
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
import { getGlobalSettings } from './storage/settings-store.js'
import { createExtProtocolHandler } from './extensions/ext-protocol.js'
import { EXTENSION_BASE_CSS } from '@terminator/extension-ui/extension-base-css'
import { recordUsage } from './extensions/extension-usage.js'
import { FrameBridge, registerFramePortChannel } from './extensions/frame-bridge.js'
import { routeExtensionExitRequest, type ExtensionSurface } from './extensions/extension-exit.js'
import { flushLogs, logger } from './logger.js'
import { sendToWindow } from './safe-send.js'
import { buildWindowMenu } from './window-menu.js'
import { breakoutWindowOpen, sessionOfWindow, watchBreakoutWindows } from './breakout-windows.js'
import { bridgeEventBus } from './remote/bridge-event-bus.js'
import { ipcInvokeRegistry, ipcSendRegistry } from './remote/ipc-registry.js'
import { initAppDb, getAppDb, closeAppDb } from './db/index.js'
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
const frameBridge = new FrameBridge({
  invokeRegistry: ipcInvokeRegistry,
  sendRegistry: ipcSendRegistry,
  onExitRequest: (surface) => exitExtensionSurface(surface),
  onQuickActionsOpen: () => mainWindow?.webContents.send('quick-actions:open'),
  onSettingsOpen: () => mainWindow?.webContents.send('menu:open-settings'),
  onUsage: (extensionId, feature, failed) =>
    recordUsage({ feature: `${extensionId}.${feature}`, via: 'click', failed }),
})
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

function loadRenderer(win: BrowserWindow): void {
  if (process.env.NODE_ENV === 'development' || process.env['ELECTRON_RENDERER_URL']) {
    win.loadURL(process.env['ELECTRON_RENDERER_URL'] || 'http://localhost:5173')
  } else {
    win.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

/** Forwards every main→renderer push to browser bridge clients and extension frames. */
function relayPushes(win: BrowserWindow): void {
  const _origSend = win.webContents.send.bind(win.webContents)
  win.webContents.send = (channel: string, ...args: unknown[]) => {
    _origSend(channel, ...args)
    // A file watch reports to the one view that asked for it (ADR 109), this window included.
    if (channel === 'fs:changed') return
    bridgeEventBus.emit(channel, ...args)
    // Relay to extension frames so extension renderers receive push events
    // (terminal: is high-frequency; workspace:changed is relayed separately below)
    if (!channel.startsWith('terminal:') && channel !== 'workspace:changed') {
      frameBridge.broadcast(channel, args[0] as unknown)
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
  win.webContents.setWindowOpenHandler((details) => {
    const breakout = breakoutWindowOpen(details)
    if (breakout) return breakout
    openExternally(details.url)
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
  const win = newWindow({
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
  announceWindowReadiness(win)
  loadRenderer(win)
  relayPushes(win)
  openLinksInBrowser(win)
  watchBreakoutWindows(win, openLinksInBrowser)
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
        // A rebuild (every window focus) keeps the ticks of panels already open.
        checked: Menu.getApplicationMenu()?.getMenuItemById(item.id)?.checked ?? false,
        click: item.onClick,
      }) as Electron.MenuItemConstructorOptions
  )
}

/** The application menu macOS shows under the app's name; nothing elsewhere. */
function appNameMenu(): Electron.MenuItemConstructorOptions[] {
  if (process.platform !== 'darwin') return []
  return [
    {
      label: app.getName(),
      submenu: [
        { label: `About ${app.getName()}`, click: openAbout },
        { label: 'Check for Updates…', click: () => void checkForUpdatesNow() },
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
    buildViewMenu({
      send: (channel) => mainWindow?.webContents.send(channel),
      pressKey: (keyCode) =>
        mainWindow?.webContents.sendInputEvent({
          type: 'keyDown',
          keyCode,
          modifiers: ['meta', 'alt'],
        }),
      openDevTools: () => mainWindow?.webContents.openDevTools({ mode: 'detach' }),
      extensionItems: extensionViewMenuItems(),
    }),
    buildWindowMenu(
      (channel, payload) => mainWindow?.webContents.send(channel, payload),
      sessionOfWindow(BrowserWindow.getFocusedWindow())
    ),
    buildHelpMenu(app.getName(), openAbout, (url) => void shell.openExternal(url)),
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
      tickPanelItem(Menu.getApplicationMenu(), getPanelMenuItemId(panelId), open)
    }
  )

  registerAppInfoHandlers()
}

app.on('browser-window-focus', setupMenu)

app.on('second-instance', () => {
  if (!mainWindow) return
  if (mainWindow.isMinimized()) mainWindow.restore()
  revealWindow(mainWindow)
})

// Must be called before app.ready so Chromium treats ext:// as a secure standard
// origin — without this, service worker storage and fetch() fail inside WebContentsViews.
protocol.registerSchemesAsPrivileged([
  {
    scheme: 'ext',
    privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true },
  },
])

/** The `ext://` handler: extension files, and the frame shim at ext://core/. Only the default
 * session serves it, because extension frames now live in the main window's session. */
function registerExtProtocol(): void {
  session.defaultSession.protocol.handle(
    'ext',
    createExtProtocolHandler({
      extensionDirectory: (id) => extensionHost.getExtensionDirectory(id),
      coreDirectory: join(__dirname, '../renderer-remote'),
      baseCss: EXTENSION_BASE_CSS,
    })
  )
}

/** Where the double-Escape gesture in a frame leaves to: main attributes it to a surface and
 * relays the exit to the main window. */
function exitExtensionSurface(surface: ExtensionSurface): void {
  if (!mainWindow || mainWindow.isDestroyed()) return
  routeExtensionExitRequest(surface, {
    listExtensions: () => extensionHost.listAll(),
    focusMainRenderer: () => mainWindow!.webContents.focus(),
    send: (channel, payload) => mainWindow!.webContents.send(channel, payload),
  })
}

/** What the main window sends about extension frames: the theme and the active workspace. */
function registerExtensionViewChannels(): void {
  onChannel('extension:set-theme', (_event, { theme }: { theme: 'dark' | 'light' }) => {
    frameBridge.setTheme(theme)
  })
  onChannel('workspace:active-changed', (_event, data: ActiveWorkspaceContext) => {
    setActiveWorkspaceContext(data)
    frameBridge.broadcast('workspace:changed', data)
  })
  registerFramePortChannel(frameBridge, (id) => extensionHost.whenActivated(id))
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
  registerExtensionHandlers(extensionHost, (channel, data) =>
    mainWindow?.webContents.send(channel, data)
  )
  registerExtensionViewChannels()
  registerGitHandlers()
  registerIntegrationsHandlers(() => mainWindow)
  registerSessionRecordsHandlers(() => mainWindow)
  registerAgentAskHandlers(() => mainWindow)
  registerAgentTurnHandlers(() => mainWindow)
  startAgentService(broadcastToWindows)
  registerAgentsHandlers()
  registerTaskHandlers(() => mainWindow)
  registerAttentionHandlers()
  registerUsageHandlers()
  registerAgentUsageHandlers()
  registerThreadSummaryHandler()
  registerHomeFeedHandlers(() => mainWindow)
  void registerScheduleHandlers(() => mainWindow)
  return terminalRelay
}

/** Issue links, session records and the agent session hook, read and installed in the background. */
function startIntegrationsAndRecords(): void {
  // Links are read once and held in memory; every reader of them is on a hot
  // path (the sidebar draws a badge per project) and none can await a file.
  void loadLinks()
  registerLinkGarbageCollection()
  closeSessionsOfDeletedProjects({ pty: ptyManager, markClosed })
  // Nothing can be open at startup: sessions die with the app, so whatever the
  // last run left open is closed at its last update before anyone reads it.
  void loadTasks().catch((error) => logger.error('could not load tasks', { error: String(error) }))
  // A closed session's record is kept as long as the operator's setting says, read at each purge.
  configureRetention(() => getGlobalSettings().sessions.deleteClosedAfterHours * 60 * 60 * 1000)
  startPurging()
  void loadRecords()
    .then(sweepOpenRecords)
    .then(() => startAgentSessionWatcher({ snapshotFor: makeSnapshotFor(ptyManager) }))
    .catch((error) =>
      logger.error('agent session capture failed to start', { error: String(error) })
    )
  // Lets an agent — including one the operator starts by hand — report the
  // conversation it is having, so the session can be resumed later (ADR 055).
  // One hook script reports sessions, asks and turns for every Claude Code conversation (ADR 055).
  // Written at startup rather than shipped beside the bundle (ADR-026); project hooks share it.
  startAskWatcher()
  const userHooks = ensureHookScript()
    .then((scriptPath) => installUserHooks({ execPath: process.execPath, scriptPath }))
    .catch((error) => logger.error('could not install the Claude hook', { error: String(error) }))
  startTerminatorMcpServer(userHooks)
  void loadAttentionLog().catch((error) =>
    logger.error('could not read the attention log', { error: String(error) })
  )
}

let mcpServer: Promise<{ close(): Promise<void> } | null> = Promise.resolve(null)

/** The main window, shown and focused; created first if it was closed, as a Dock click does. */
function showMainWindow(): BrowserWindow {
  if (!mainWindow) createWindow()
  // createWindow sets mainWindow.
  const window = mainWindow!
  revealWindow(window)
  return window
}

/** The Terminator MCP server, its relay, and the relay's entry in Claude Code (ADR 145).
 * Registration waits for `userHooks`: both rewrite ~/.claude/settings.json, and two writers at
 * once lose one change. */
function startTerminatorMcpServer(userHooks: Promise<void>): void {
  const userData = app.getPath('userData')
  const socketPath = mcpSocketPath(userData, app.getPath('temp'))
  const directory = join(userData, 'mcp')
  registerRendererTools({ showWindow: showMainWindow })
  const updateTools = appTools({
    checkForUpdate: checkForUpdatesQuietly,
    downloadedUpdate,
    quitAndInstall: installUpdateNow,
    showWindow: showMainWindow,
  })
  mcpServer = startMcpServer({
    socketPath,
    providers: [manifestTools, alertTool, rendererTools, updateTools, moveSessionTool],
    version: app.getVersion(),
  })
  const registration = Promise.all([installRelayScript(directory), mcpServer]).then(
    ([relayPath]) => ({ relayPath, socketPath, directory })
  )
  registerClaudeCodeHandlers(registration)
  void Promise.all([registration, userHooks])
    .then(([options]) => registerWithClaude(options))
    .catch((error) =>
      logger.error('could not start the Terminator MCP server', { error: String(error) })
    )
}

/** Shell, editor, files, logging, notifications, metrics, the database, dialogs and the app. */
function registerToolHandlers(): void {
  registerShellHandlers()
  registerEditorHandlers()
  registerFsHandlers()
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
  // The main window's send is patched above to relay to extension frames for every
  // channel except the two it filters out — only relay explicitly when that patch did not already
  // do it, or the frames would receive the same push twice.
  const relayedByMainWindow =
    !!mainWindow &&
    !mainWindow.isDestroyed() &&
    !mainWindow.webContents.isDestroyed() &&
    !channel.startsWith('terminal:') &&
    channel !== 'workspace:changed'
  if (!relayedByMainWindow) frameBridge.broadcast(channel, data)
}

function extensionDeps(terminalRelay: OutputRelay, userData: string): ExtensionAPIDeps {
  return {
    ptyManager,
    terminalRelay,
    db: getAppDb(),
    paths: { app: app.getAppPath(), userData },
    broadcastToWindows,
    focusExtensionView: (extensionId, viewParam) =>
      mainWindow?.webContents.send('extension:focus-view', { extensionId, viewParam }),
    bridge: {
      invokeRegistry: ipcInvokeRegistry,
      sendRegistry: ipcSendRegistry,
      eventBus: bridgeEventBus,
    },
  }
}

/** The renderer lists the extensions (complete as soon as start is called) and each extension
 * view waits for its own backend, so none of this holds the window back. */
function startExtensions(loginShellPath: Promise<void>): void {
  extensionHost
    .startAll({
      bundledDirectory: join(__dirname, '../../extensions'),
      beforeActivation: loginShellPath,
    })
    .then(setupMenu)
    .catch((error) => logger.error('extension startup failed', { error: String(error) }))
}

enterBackgroundMode()
exposeReadinessToTests()

/** Counting must never stop the app starting: a usage.sqlite that cannot open is logged. */
async function startUsageCounting(userData: string): Promise<void> {
  try {
    initUsageStore(userData)
    await getUsageStore().declare(CORE_FEATURES)
    await getUsageStore().recordUse({ feature: 'core.app.launch', via: 'app' })
  } catch (error) {
    logger.warn(`usage counting is off: ${String(error)}`)
  }
}

app.whenReady().then(async () => {
  logger.info('App ready', { version: app.getVersion() })
  // Slow (a login shell starts) and only extensions need its result, so it runs
  // while the window and the database come up.
  const loginShellPath =
    process.platform === 'darwin' ? startAdoptingLoginShellPath() : Promise.resolve()

  const userData = app.getPath('userData')
  initAppDb(userData)
  await startUsageCounting(userData)
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
  // A renderer tool called while startup ran may have made the window already.
  if (!mainWindow) createWindow()
  startAppUpdates(() => mainWindow && revealWindow(mainWindow))

  app.on('activate', () => {
    if (mainWindow) {
      revealWindow(mainWindow)
    } else {
      createWindow()
    }
  })
  startExtensions(loginShellPath)
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
  await extensionHostProcess.stopHost()
  // After the extensions, which start most of them: a git or gh command still
  // running, and whatever it started, would outlive the app.
  await stopRunningCommands()
  await disposeAgentService()
  await mcpServer.then((server) => server?.close()).catch(() => undefined)
  await ptyManager.killAll()
  closeAppDb()
  closeUsageStore()
  // Last, so what the steps above logged reaches the file before the process ends.
  await flushLogs()
  app.exit(0)
})

// quitAndInstall() closes the windows before before-quit fires; the close handler would hide them
// instead and the update would never install.
autoUpdater.on('before-quit-for-update', () => {
  isQuitting = true
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
