import { WebContentsView, session as electronSession } from 'electron'
import type { BrowserWindow } from 'electron'
import type { Extension } from '../../shared/types/index.js'
import { makeLogger } from '../logger.js'
import { sendToView } from '../safe-send.js'
import { EXTENSION_BASE_CSS } from '@terminator/extension-ui/extension-base-css'

const logger = makeLogger('extension-view-host')

/**
 * Whether a `before-input-event` from an extension WebContentsView is the
 * quick-actions leader (⌘P on mac, Ctrl+P elsewhere). Exported as a pure
 * function so the mac/other-platform branches are unit-testable without an
 * Electron WebContentsView.
 */
export function isQuickActionsOpenShortcut(
  input: {
    type: string
    key: string
    meta: boolean
    control: boolean
    shift: boolean
    alt: boolean
  },
  platform: NodeJS.Platform = process.platform
): boolean {
  if (input.type !== 'keyDown') return false
  if (input.key.toLowerCase() !== 'p') return false
  if (input.shift || input.alt) return false
  return platform === 'darwin' ? input.meta : input.control
}

// Injected into every extension WebContentsView so --tm-* CSS variables are defined.
// An extension view is a separate document that does not load the core stylesheet,
// so both themes come with it. The host stamps `data-theme` on the view's <html>
// and restamps it when the theme changes. The text lives in the design system.
export { EXTENSION_BASE_CSS }

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

/**
 * Stamps `data-theme` on an extension document's root element.
 *
 * Dark is the `:root` default in EXTENSION_BASE_CSS, so the attribute is
 * removed rather than set to "dark" — one way to express each theme, and no
 * chance of the two disagreeing.
 */
async function applyTheme(contents: Electron.WebContents, theme: 'dark' | 'light'): Promise<void> {
  const js =
    theme === 'light'
      ? "document.documentElement.setAttribute('data-theme','light')"
      : "document.documentElement.removeAttribute('data-theme')"
  try {
    await contents.executeJavaScript(js)
  } catch {
    // A view can be destroyed between the theme change and this running.
  }
}

export class ExtensionViewHost {
  private views = new Map<string, ViewEntry[]>()
  /**
   * The app's theme, mirrored onto every extension document.
   *
   * An extension view is a separate document and never reads the renderer's
   * `data-theme`, so without this the light palette in EXTENSION_BASE_CSS
   * would be dead CSS: the tokens exist but the selector never matches.
   * Held here so a view created after a theme change starts in the right one
   * rather than flashing dark.
   */
  private theme: 'dark' | 'light' = 'dark'
  private mainWindow: BrowserWindow
  private preloadPath: string
  private bottomInset = 0
  /**
   * How much of the window's left edge something else has claimed.
   *
   * A `WebContentsView` is a native overlay: it paints above the renderer's
   * DOM, so anything the renderer draws over it is invisible. The blunt answer
   * — hide the view while a modal is open — is right for a centred dialog and
   * wrong for a drawer pinned to one edge, because it blanks the whole
   * application to show a 340px panel. Reserving the strip instead keeps the
   * extension on screen, just narrower.
   */
  private leftInset = 0
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

    // ⌘P (mac) / Ctrl+P (else) is the quick-actions leader everywhere else in
    // the app, but an extension view is a separate WebContentsView with its
    // own webContents — the main window's own keydown listener never sees it.
    view.webContents.on('before-input-event', (event, input) => {
      if (!isQuickActionsOpenShortcut(input)) return
      event.preventDefault()
      this.mainWindow.webContents.focus()
      this.mainWindow.webContents.send('quick-actions:open')
    })

    view.webContents.on('did-finish-load', () => {
      view.webContents.insertCSS(EXTENSION_BASE_CSS).catch(() => {})
      void applyTheme(view.webContents, this.theme)
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
    // Never left of the reserved strip, and never wider than what is left of
    // the window once it is taken.
    const x = Math.max(Math.round(bounds.x), this.leftInset)
    const y = Math.round(bounds.y)
    const maxH = winH - y - this.bottomInset
    const height = Math.min(Math.round(bounds.height), Math.max(0, maxH))
    entry.view.setBounds({ x, y, width: Math.max(0, winW - x), height })
    entry.view.setVisible(visible)
  }

  /** Reapplies every view's bounds after an inset changed. */
  private reapply(): void {
    for (const entries of this.views.values()) {
      for (const entry of entries) {
        if (entry.lastBounds && entry.lastVisible) {
          this.applyBounds(entry, entry.lastBounds, entry.lastVisible)
        }
      }
    }
  }

  setBottomInset(inset: number): void {
    this.bottomInset = Math.max(0, inset)
    this.reapply()
  }

  setLeftInset(inset: number): void {
    this.leftInset = Math.max(0, inset)
    this.reapply()
  }

  /**
   * Switch every open extension view to the app's theme, and remember it for
   * views created later.
   */
  setTheme(theme: 'dark' | 'light'): void {
    if (this.theme === theme) return
    this.theme = theme
    for (const entries of this.views.values()) {
      for (const { view } of entries) {
        void applyTheme(view.webContents, theme)
      }
    }
  }

  broadcastToAll(channel: string, data: unknown): void {
    for (const entries of this.views.values()) {
      for (const { view } of entries) {
        sendToView(view, channel, data)
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
      sendToView(view, channel, data)
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
