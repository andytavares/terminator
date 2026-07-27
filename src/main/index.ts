import { handleChannel, onChannel } from './ipc/channel-registrar.js'
import { app, BrowserWindow, dialog, Menu, shell, net, session, protocol } from 'electron'
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
import { registerSupervisionHandlers } from './ipc/supervision.ipc.js'
import { createSupervisionService } from './supervision/supervision-service.js'
import { createStateFanout } from './supervision/state-fanout.js'
import { supervisionStore } from './storage/supervision-store.js'
import { setSupervisionDeps } from './extensions/api.js'
import { mayArchive } from './supervision/worktree/archive.js'
import { openInEditor } from './supervision/worktree/editor-handoff.js'
import { runCommand } from './codehost/codehost-client.js'
import { reviewIntent } from './supervision/review/intent-diff.js'
import { laneViews, mayMergeLane } from './supervision/lanes/lane-coordination.js'
import { PtyManager } from './terminal/pty-manager.js'
import { ExtensionHost } from './extensions/extension-host.js'
import { ExtensionViewHost } from './extensions/extension-view-host.js'
import { logger } from './logger.js'
import { notificationManager } from './notifications/notification-manager.js'
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

  // Supervision substrate. Composed in supervision-service.ts; this is the only
  // place it is constructed. Stall detection starts in shadow mode by default
  // (FR-018) — it records from the first run but stays silent until the
  // operator turns shadow mode off on the evidence of the precision report.
  const stateFanout = createStateFanout({
    toRenderer: (change) => mainWindow?.webContents.send('supervision:stateChanged', change),
    onSubscriberError: (error) =>
      logger.error('[supervision] extension state subscriber failed', error),
  })

  const supervision = createSupervisionService({
    userDataPath: userData,
    registryStore: {
      get: () => supervisionStore.get('sessions'),
      set: (value) => supervisionStore.set('sessions', value),
    },
    shadowStore: {
      get: () => supervisionStore.get('stallShadowMode') as boolean | undefined,
      set: (value) => supervisionStore.set('stallShadowMode', value),
    },
    bindingStore: {
      get: () => supervisionStore.get('laneBindings'),
      set: (value) => supervisionStore.set('laneBindings', value),
    },
    onStateChanged: (change) => stateFanout.publish(change),
    onPublicationsChanged: () => mainWindow?.webContents.send('supervision:workItemsChanged', {}),
    // FR-027: a stall is a non-blocking indicator, never a modal. The service
    // has already applied the channel policy — anything that reaches here is
    // meant to be seen.
    notify: (entry) =>
      void notificationManager.create({
        type: 'warning',
        title: 'A session stopped making progress',
        message: entry.summary,
        key: 'supervision.stalled',
      }),
  })
  supervision.start()
  app.on('will-quit', () => supervision.stop())

  // Publish the read-only supervision surface to extensions. Injected rather
  // than imported by api.ts, so the dependency runs one way: the composition
  // root knows about both, and neither knows about the other.
  setSupervisionDeps({
    listSessions: () => supervision.listSessions(),
    getSession: (sessionId) => supervision.getSession(sessionId),
    onStateChanged: (handler) => stateFanout.subscribe(handler),
    provisionWorktree: async (opts) => {
      const result = await supervision.provisioner.provision({
        sessionId: opts.workItemId ?? opts.branch,
        workItemId: opts.workItemId ?? opts.branch,
        repoPath: opts.repoPath,
        branch: opts.branch,
        worktreeRoot: join(app.getPath('userData'), 'worktrees'),
      })
      return {
        path: result.worktreePath,
        portBase: result.ports.portBase,
        portSpan: result.ports.portSpan,
      }
    },
    releaseWorktree: async (worktreePath) => {
      const session = supervision
        .listSessions()
        .find((candidate) => candidate.worktreePath === worktreePath)
      if (session === undefined) return
      await supervision.provisioner.release({
        repoPath: session.repoPath,
        worktreePath,
        workItemId: session.workItemId ?? session.id,
        portBase: 0,
      })
    },
    listWorktrees: () =>
      supervision.listSessions().map((session) => ({
        path: session.worktreePath,
        branch: session.branch,
        sessionId: session.id,
      })),
    publicationDirectoryFor: async (producerId) => supervision.publicationDirectoryFor(producerId),
    registerProducer: (producerId, handlers) =>
      supervision.producers.register(producerId, handlers),
    unregisterProducer: (producerId) => supervision.producers.unregister(producerId),
  })

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

  onChannel('workspace:active-changed', (_event, data) => {
    viewHost?.broadcastToAll('workspace:changed', data)
  })
  registerGitHandlers()
  registerShellHandlers()
  registerFsHandlers(() => mainWindow)
  registerLogHandlers()
  registerNotificationHandlers()
  registerMetricsHandlers(ptyManager)
  registerDbIpcHandlers()
  registerSupervisionHandlers({
    listSessions: () => supervision.listSessions(),
    getSession: (sessionId) => supervision.getSession(sessionId),
    resolvePermission: (sessionId, requestId, decision) =>
      supervision.driver.resolvePermission(sessionId, requestId, { allow: decision === 'allow' }),
    setShadowMode: (value) => supervision.stalls.setShadowMode(value),
    judgeFiring: (firingId, judgement) =>
      supervision.firings.judge(firingId, judgement, Date.now()),
    listFeed: () => supervision.feed.list(),
    listFirings: () => ({
      firings: supervision.firings.list(),
      precision: supervision.firings.precision(0, Date.now()),
    }),
    listReview: () => supervision.reviewQueue.list(),
    listUnattendedMerges: () => supervision.mergePolicy.unattendedMerges(),
    listWorkItems: () => {
      const snapshot = supervision.publications.snapshot()
      return {
        items: snapshot.items.map((published) => ({
          producerId: published.producerId,
          item: published.item,
        })),
        unreadable: snapshot.unreadable,
        conflicts: snapshot.conflicts,
        // Read-only until some producer registers the actions (FR-078).
        canAct: snapshot.items.some((published) =>
          supervision.producers.supports(published.producerId, 'approveGate')
        ),
      }
    },
    getReviewDetail: (sessionId) => {
      const item = supervision.reviewQueue.list().find((entry) => entry.sessionId === sessionId)
      if (item === undefined) return null
      const session = supervision.getSession(sessionId)
      return {
        item,
        intent: reviewIntent({
          request:
            supervision.feed.forSession(sessionId).find((entry) => entry.author === 'agent')
              ?.summary ?? item.branch,
          agentAccount:
            supervision.feed.forSession(sessionId).at(-1)?.summary ?? 'No account recorded.',
          changedFiles: supervision.changedFilesFor(sessionId),
          // Declared by the bound lane's work item; empty for ad-hoc work,
          // where there is no declared scope to compare against.
          expectedFiles: supervision.expectedFilesFor(sessionId),
        }),
        hunks: supervision.hunksFor(sessionId),
        session,
      }
    },
    // FR-028: routine progress never interrupts — it is batched here and read
    // when the operator chooses to. Batching it and then never showing it
    // would be the same as dropping it.
    getDigest: (windowMs) => {
      const to = Date.now()
      return supervision.digestSince(to - windowMs, to)
    },
    // FR-083/FR-084: approving a gate, rejecting it with notes, or sending an
    // item back is the only way implementation ever becomes allowed. It is
    // always the producer that writes it — the console never edits the
    // contract file (FR-076).
    producerAction: (workItemId, action, args) =>
      supervision.runProducerAction(workItemId, action, args),
    decideHunk: (sessionId, hunkId, decision) =>
      supervision.hunkDecisionsFor(sessionId).decide(hunkId, decision),
    advanceReview: (sessionId) => {
      supervision.reviewQueue.advance(sessionId)
    },
    getLanes: (workItemId) => {
      const published = supervision.publications
        .snapshot()
        .items.find((entry) => entry.item.id === workItemId)
      if (published === undefined) {
        return { lanes: [], mergedOrds: [], staleOrds: [], blockedReasons: {} }
      }
      const merged = supervision
        .listSessions()
        .filter((session) => session.runtimeState === 'merged' && session.laneOrd !== null)
        .map((session) => session.laneOrd as number)
      const blockedReasons: Record<number, string> = {}
      for (const view of laneViews(published.item)) {
        const decision = mayMergeLane(published.item, view.lane.ord, merged)
        if (!decision.allowed && decision.reason !== null) {
          blockedReasons[view.lane.ord] = decision.reason
        }
      }
      return {
        lanes: laneViews(published.item),
        mergedOrds: merged,
        staleOrds: supervision.staleLanesFor(workItemId),
        blockedReasons,
      }
    },
    mergeLane: async (workItemId, ord) => {
      const published = supervision.publications
        .snapshot()
        .items.find((entry) => entry.item.id === workItemId)
      if (published === undefined) return { ok: false, reason: 'no such work item' }
      const merged = supervision
        .listSessions()
        .filter((session) => session.runtimeState === 'merged' && session.laneOrd !== null)
        .map((session) => session.laneOrd as number)
      const decision = mayMergeLane(published.item, ord, merged)
      if (!decision.allowed) return { ok: false, reason: decision.reason }
      const binding = supervision.laneBindings.forLane(workItemId, ord)
      const session = binding === null ? null : supervision.getSession(binding.sessionId)
      if (session === null) return { ok: false, reason: 'no session is bound to that lane' }
      return supervision.codeHost.merge(session.repoPath, session.branch)
    },
    getProvisioning: (sessionId) => supervision.provisioningFor(sessionId),
    getSinceLastLooked: (sessionId) => supervision.sinceLastLooked(sessionId, Date.now()),
    precheckBackpressure: () => supervision.backpressure.check(),
    entityIndex: () =>
      supervision.entityIndex([
        { id: 'toggle-shadow', label: 'Toggle stall shadow mode' },
        { id: 'open-attention', label: 'Open the attention queue' },
      ]),
    intake: (input) => supervision.intake(input),
    assign: (request) =>
      supervision.assigner.assign({
        ...(request as Parameters<typeof supervision.assigner.assign>[0]),
        worktreeRoot: join(app.getPath('userData'), 'worktrees'),
      }),
    replyToSession: (sessionId, message) =>
      supervision.feedReply.reply(
        supervision.feed
          .forSession(sessionId)
          .filter((entry) => entry.replyable)
          .at(-1)?.id ?? '',
        message
      ),
    archive: async (sessionId) => {
      const session = supervision.getSession(sessionId)
      if (session === null) return { allowed: false, reason: 'no such session' }
      const decision = mayArchive(session.runtimeState)
      if (!decision.allowed) return decision
      await supervision.provisioner.release({
        repoPath: session.repoPath,
        worktreePath: session.worktreePath,
        workItemId: session.workItemId ?? sessionId,
        portBase: 0,
      })
      return decision
    },
    openInEditor: async (sessionId) => {
      const session = supervision.getSession(sessionId)
      if (session === null) return { ok: false, reason: 'no such session' }
      return openInEditor({
        editorCommand: (supervisionStore.get('externalEditor') as string | undefined) ?? null,
        worktreePath: session.worktreePath,
        run: runCommand,
      })
    },
  })
  registerDialogHandlers()
  registerAppHandlers()

  extensionHost.setDeps({
    ptyManager,
    db: getAppDb(),
    broadcastToWindows: (channel, data) => {
      mainWindow?.webContents.send(channel, data)
      viewHost?.broadcastToAll(channel, data)
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
