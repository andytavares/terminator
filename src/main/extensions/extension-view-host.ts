import { WebContentsView, session as electronSession } from 'electron'
import type { BrowserWindow } from 'electron'
import type { Extension } from '../../shared/types/index.js'
import { makeLogger } from '../logger.js'

const logger = makeLogger('extension-view-host')

// Injected into every extension WebContentsView so --tm-* CSS variables are defined.
// Extensions use these to match the app's dark theme without sharing the main renderer context.
export const EXTENSION_BASE_CSS = `
:root {
  --tm-bg-base: #0c0c0f;
  --tm-bg-surface: #111116;
  --tm-bg-elevated: #18181f;
  --tm-bg-card: #1c1c25;
  --tm-bg-card-hover: #22222e;
  --tm-bg-input: #16161c;
  --tm-text-primary: #e2e2ee;
  --tm-text-secondary: #9090c4;
  --tm-text-muted: #8585b8;
  --tm-border: rgba(255,255,255,0.06);
  --tm-border-strong: rgba(255,255,255,0.12);
  --tm-accent: #5c6bc0;
  --tm-accent-dim: rgba(92,107,192,0.18);
  --tm-accent-glow: rgba(92,107,192,0.35);
  --tm-danger: #e05c5c;
  --tm-success: #4ade80;
  --tm-warning: #facc15;
  --tm-diff-added-bg: rgba(152,195,121,0.12);
  --tm-diff-removed-bg: rgba(224,108,117,0.12);
  --tm-syntax-comment: #8585b8;
  --tm-syntax-keyword: #cf9ee8;
  --tm-syntax-string: #4ade80;
  --tm-syntax-tag: #e05c5c;
  --tm-syntax-literal: #6cc9d9;
  --tm-syntax-number: #e0a361;
  --tm-syntax-title: #7fb8f0;
  --tm-syntax-attribute: #e2c07e;
  --tm-radius-xs: 4px;
  --tm-radius-sm: 6px;
  --tm-radius-md: 10px;
  --tm-radius-lg: 16px;
  --tm-font-mono: 'IBM Plex Mono','JetBrains Mono','Fira Code','Courier New',monospace;
  --tm-font-ui: 'IBM Plex Sans',-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;
}
*, *::before, *::after { box-sizing: border-box; }
html, body {
  width: 100%; height: 100%; margin: 0; padding: 0;
  background: var(--tm-bg-base);
  color: var(--tm-text-primary);
  font-family: var(--tm-font-ui);
  -webkit-font-smoothing: antialiased;
}
#app { width: 100%; height: 100%; display: flex; flex-direction: column; }
`

interface BoundsRect {
  x: number
  y: number
  width: number
  height: number
}

interface ViewEntry {
  view: InstanceType<typeof WebContentsView>
  extensionId: string
  viewParam: string
  lastRepoRoot: string | null
  lastBounds: BoundsRect | null
  lastVisible: boolean
}

export class ExtensionViewHost {
  private views = new Map<string, ViewEntry[]>()
  private mainWindow: BrowserWindow
  private preloadPath: string
  private bottomInset = 0
  // Bounds updates can arrive while createView is still awaiting loadURL; the
  // latest one per view is applied once creation finishes.
  private pendingBounds = new Map<
    string,
    { bounds: BoundsRect; visible: boolean; repoRoot?: string | null }
  >()
  private creatingViews = new Set<string>()
  // The extension view that currently holds keyboard focus, or null when focus
  // sits in the main renderer. Electron restores focus to the window's own
  // webContents on window focus (and on macOS skips even that), so the child
  // view that was focused before the app lost focus has to be re-focused by
  // hand — see restoreFocus().
  private focusedViewKey: string | null = null
  private focusKeyToRestore: string | null = null

  constructor(mainWindow: BrowserWindow, preloadPath: string) {
    this.mainWindow = mainWindow
    this.preloadPath = preloadPath
  }

  /**
   * Records which surface owns keyboard focus. Called from the webContents
   * 'focus' events wired up in createView and from the main window's own
   * webContents focus event (with null).
   */
  noteFocused(viewKey: string | null): void {
    this.focusedViewKey = viewKey
  }

  /**
   * Snapshots the focused surface as the window loses focus. Must run on
   * 'blur', not 'focus': by the time the window's 'focus' event fires Electron
   * has already moved focus to the main webContents, clobbering the record.
   */
  captureFocusTarget(): void {
    this.focusKeyToRestore = this.focusedViewKey
  }

  /**
   * Re-focuses the surface that was focused when the window lost focus, so the
   * user can type immediately instead of having to click the panel again.
   * Falls back to the main renderer when the remembered view is gone or hidden.
   */
  restoreFocus(): void {
    const key = this.focusKeyToRestore
    if (key) {
      for (const entries of this.views.values()) {
        for (const entry of entries) {
          if (`${entry.extensionId}:${entry.viewParam}` === key && entry.lastVisible) {
            entry.view.webContents.focus()
            return
          }
        }
      }
    }
    this.mainWindow.webContents.focus()
  }

  /**
   * The single entry point for panel placement: lazily creates the view on
   * first update (deduplicating concurrent creations) and positions it with
   * the most recent bounds. `resolveExt` is only called when a view actually
   * needs creating — bounds updates fire on every ResizeObserver tick, so the
   * steady-state path must stay allocation-free. It may return undefined when
   * the extension is not installed; the update is then a no-op until it appears.
   */
  async updatePanelBounds(
    resolveExt: () => Extension | undefined,
    extensionId: string,
    viewParam: string,
    bounds: BoundsRect,
    visible: boolean,
    repoRoot?: string | null
  ): Promise<void> {
    if (this.hasView(extensionId, viewParam)) {
      this.handleBoundsUpdate(extensionId, viewParam, bounds, visible, repoRoot)
      return
    }

    const viewKey = `${extensionId}:${viewParam}`
    this.pendingBounds.set(viewKey, { bounds, visible, repoRoot })
    if (this.creatingViews.has(viewKey)) return
    this.creatingViews.add(viewKey)
    try {
      const ext = resolveExt()
      if (ext) await this.createView(ext, viewParam, repoRoot)
      const latest = this.pendingBounds.get(viewKey)
      if (latest) {
        this.handleBoundsUpdate(
          extensionId,
          viewParam,
          latest.bounds,
          latest.visible,
          latest.repoRoot
        )
      }
    } finally {
      this.creatingViews.delete(viewKey)
      this.pendingBounds.delete(viewKey)
    }
  }

  async createView(ext: Extension, viewParam: string, repoRoot?: string | null): Promise<void> {
    if (!ext.rendererUrl) return

    const url = buildUrl(ext.rendererUrl, viewParam, repoRoot)
    const view = new WebContentsView({
      webPreferences: {
        session: electronSession.fromPartition('ext-views'),
        preload: this.preloadPath,
        contextIsolation: true,
        nodeIntegration: false,
      },
    })

    const viewKey = `${ext.id}:${viewParam}`
    view.webContents.on('focus', () => this.noteFocused(viewKey))

    view.webContents.on('did-finish-load', () => {
      view.webContents.insertCSS(EXTENSION_BASE_CSS).catch(() => {})
      this.mainWindow.webContents.send('extension:panel-loaded', { id: ext.id, viewParam })
      // Send current workspace context so extension doesn't need to wait for a change event.
      if (repoRoot != null) {
        view.webContents.send('workspace:changed', { repoRoot })
      }
    })

    try {
      await view.webContents.loadURL(url)
    } catch (e) {
      logger.warn(`Failed to load ${url}: ${e instanceof Error ? e.message : String(e)}`)
    }

    this.mainWindow.contentView.addChildView(view)

    const existing = this.views.get(ext.id) ?? []
    this.views.set(ext.id, [
      ...existing,
      {
        view,
        extensionId: ext.id,
        viewParam,
        lastRepoRoot: repoRoot ?? null,
        lastBounds: null,
        lastVisible: false,
      },
    ])
  }

  focusView(extensionId: string, viewParam: string): void {
    const entry = this.views.get(extensionId)?.find((e) => e.viewParam === viewParam)
    if (!entry) return
    entry.view.webContents.focus()
    this.noteFocused(`${extensionId}:${viewParam}`)
  }

  destroyAllViews(extensionId: string): void {
    const entries = this.views.get(extensionId)
    if (!entries) return
    for (const { view, viewParam } of entries) {
      this.mainWindow.contentView.removeChildView(view)
      const viewKey = `${extensionId}:${viewParam}`
      this.pendingBounds.delete(viewKey)
      if (this.focusedViewKey === viewKey) this.focusedViewKey = null
      if (this.focusKeyToRestore === viewKey) this.focusKeyToRestore = null
    }
    this.views.delete(extensionId)
  }

  reloadAllViews(extensionId: string): void {
    const entries = this.views.get(extensionId)
    if (!entries) return
    for (const { view } of entries) {
      view.webContents.reload()
    }
  }

  handleBoundsUpdate(
    extensionId: string,
    viewParam: string,
    bounds: BoundsRect,
    visible: boolean,
    repoRoot?: string | null
  ): void {
    const entries = this.views.get(extensionId)
    if (!entries) return
    const entry = entries.find((e) => e.viewParam === viewParam)
    if (!entry) return

    // Broadcast workspace context if repoRoot changed (and view is visible).
    if (visible && repoRoot != null && repoRoot !== entry.lastRepoRoot) {
      entry.lastRepoRoot = repoRoot
      entry.view.webContents.send('workspace:changed', { repoRoot })
    }

    entry.lastBounds = bounds
    entry.lastVisible = visible

    this.applyBounds(entry, bounds, visible)
  }

  private applyBounds(entry: ViewEntry, bounds: BoundsRect, visible: boolean): void {
    const { width: winW, height: winH } = this.mainWindow.getContentBounds()
    const x = Math.round(bounds.x)
    const y = Math.round(bounds.y)
    const maxH = winH - y - this.bottomInset
    const height = Math.min(Math.round(bounds.height), Math.max(0, maxH))
    entry.view.setBounds({ x, y, width: winW - x, height })
    entry.view.setVisible(visible)
  }

  setBottomInset(inset: number): void {
    this.bottomInset = Math.max(0, inset)
    for (const entries of this.views.values()) {
      for (const entry of entries) {
        if (entry.lastBounds && entry.lastVisible) {
          this.applyBounds(entry, entry.lastBounds, entry.lastVisible)
        }
      }
    }
  }

  broadcastToAll(channel: string, data: unknown): void {
    for (const entries of this.views.values()) {
      for (const { view } of entries) {
        view.webContents.send(channel, data)
      }
    }
  }

  /**
   * Identifies which extension surface a webContents belongs to. Extension
   * views are separate webContents, so IPC arriving from one carries no
   * identity beyond the sender — this is how the main process attributes it.
   */
  findViewByWebContents(
    webContents: Electron.WebContents
  ): { extensionId: string; viewParam: string } | null {
    for (const entries of this.views.values()) {
      for (const entry of entries) {
        if (entry.view.webContents === webContents) {
          return { extensionId: entry.extensionId, viewParam: entry.viewParam }
        }
      }
    }
    return null
  }

  hasView(extensionId: string, viewParam: string): boolean {
    return !!this.views.get(extensionId)?.some((e) => e.viewParam === viewParam)
  }

  broadcastToExtension(extensionId: string, channel: string, data: unknown): void {
    const entries = this.views.get(extensionId)
    if (!entries) return
    for (const { view } of entries) {
      view.webContents.send(channel, data)
    }
  }

  openDevToolsForAll(): void {
    for (const entries of this.views.values()) {
      for (const { view } of entries) {
        view.webContents.openDevTools({ mode: 'detach' })
      }
    }
  }
}

function buildUrl(rendererUrl: string, viewParam: string, repoRoot?: string | null): string {
  const url = new URL(rendererUrl)
  if (viewParam) url.searchParams.set('view', viewParam)
  if (repoRoot) url.searchParams.set('repoRoot', repoRoot)
  return url.toString()
}
