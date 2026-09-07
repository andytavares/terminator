import { WebContentsView, session as electronSession } from 'electron'
import type { BrowserWindow } from 'electron'
import type { Extension } from '../../shared/types/index.js'
import { makeLogger } from '../logger.js'
import { sendToView } from '../safe-send.js'

const logger = makeLogger('extension-view-host')

// Injected into every extension WebContentsView so --tm-* CSS variables are defined.
// Extensions use these to match the app's theme without sharing the main
// renderer context. Both palettes have to be here: an extension view is a
// separate document that does not load the core stylesheet, and until this
// block gained a `[data-theme='light']` counterpart every extension panel
// stayed dark while the rest of the app went light. The host stamps
// `data-theme` on the view's <html> and restamps it when the theme changes.
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
  --tm-on-accent: #ffffff;
  /* The accent as text or an icon, rather than as a fill. --tm-accent is dark
     enough to carry white (4.86:1) and therefore too dark to read on the dark
     surfaces (3.48:1 on --tm-bg-card); this is the same hue lifted until it
     passes as text (6.24:1). In the light theme one value does both jobs. */
  --tm-accent-text: #8b98e8;
  /* Hover for a filled accent control. It darkens in both themes: lightening
     the dark theme's accent drops white below AA (#6b79ce gives 4.00:1). */
  --tm-accent-hover: #5361b5;
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
  /* Translucent layers over whatever surface is beneath.
     Extension stylesheets reached for rgba(255,255,255,alpha) ~350 times for
     these — a hairline border, a faint hover fill, a raised strip. Every one
     of them is invisible on a light ground, so the alpha itself has to flip
     with the theme rather than the colour under it. */
  --tm-overlay-subtle: rgba(255,255,255,0.04);
  --tm-overlay-soft: rgba(255,255,255,0.06);
  --tm-overlay: rgba(255,255,255,0.09);
  --tm-overlay-strong: rgba(255,255,255,0.14);
  --tm-scrim: rgba(0,0,0,0.55);
  /* Text on a filled semantic control. The fills are bright in this theme, so
     the text on them is dark; in the light theme the fills are deep and it
     flips. */
  --tm-on-success: #06210f;
  --tm-on-warning: #241a00;
  --tm-on-danger: #2a0b0b;
  --tm-radius-xs: 4px;
  --tm-radius-sm: 6px;
  --tm-radius-md: 10px;
  --tm-radius-lg: 16px;
  --tm-space-1: 4px;
  --tm-space-2: 8px;
  --tm-space-3: 12px;
  --tm-space-4: 16px;
  --tm-space-5: 20px;
  --tm-space-6: 24px;
  --tm-space-8: 32px;
  /* The stacking scale. Extension stylesheets reference these instead of raw
     numbers; without them here every z-index in an extension view resolves to
     nothing and the stacking order collapses. Must stay in step with
     packages/extension-ui/src/layers.ts and the :root block in styles.css. */
  --tm-layer-panel: 100;
  --tm-layer-overlay: 200;
  --tm-layer-modal: 300;
  --tm-layer-toast: 400;
  --tm-font-mono: 'IBM Plex Mono','JetBrains Mono','Fira Code','Courier New',monospace;
  --tm-font-ui: 'IBM Plex Sans',-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;
}

/* Icon sizes (Constitution Principle XII).
   Icons are sized here, never with a size prop on the component. The
   extensions had 139 such props across seven ad-hoc values in a 6px band —
   10, 11, 12, 13, 14, 15, 16 — which is not seven decisions, it is one
   decision made seven times. Three steps carry all of it. Injected rather
   than exported so an extension gets them without importing anything, the
   same way it gets the colour tokens. */
.tm-icon-sm,
.tm-icon,
.tm-icon-lg {
  flex: 0 0 auto;
}
.tm-icon-sm {
  width: 12px;
  height: 12px;
}
.tm-icon {
  width: 14px;
  height: 14px;
}
.tm-icon-lg {
  width: 16px;
  height: 16px;
}

/* No button renders the browser's native control.

   Nothing in this product wants the UA button look, and relying on every
   modifier to remember a background is how a caret beside "Commit & push"
   shipped as a white pill on a dark panel. border:0 rather than a
   transparent border, so a button that wants an edge states the full
   shorthand — which every one of them already does. */
button {
  appearance: none;
  -webkit-appearance: none;
  background: transparent;
  border: 0;
  color: inherit;
  font: inherit;
  cursor: pointer;
}

/* The default an icon gets when nothing else sizes it.

   lucide renders width/height attributes of 24 when given no size, which is
   never what a 12px label wants — an icon converted from a text glyph and left
   without a rule comes out enormous. This makes the default "as tall as the
   text beside it", which is what the glyph it replaced did. Anything wanting a
   specific size says so with .tm-icon*, or its own rule; both are more
   specific than this and win.

   The :has() rule is the other half: a button that used to hold a character
   laid it out as text, and an inline SVG in the same place sits on the
   baseline instead of centred. */
button > svg,
a > svg,
label > svg,
summary > svg {
  width: 1.08em;
  height: 1.08em;
  flex: 0 0 auto;
}

/* Vertical centring only. Forcing justify-content here re-centred every
   left-aligned button that happens to contain an icon — a disclosure row,
   a menu item — which is a layout decision that belongs to the caller. */
button:has(> svg) {
  display: inline-flex;
  align-items: center;
  gap: 6px;
}

/* The light palette, mirroring [data-theme='light'] in src/renderer/styles.css.
   Those values are WCAG AA verified against their surfaces (TAV-8) — including
   the text-muted darkening and the semantic colours, which were chosen so they
   hold up composited under the diff tints. Keep the two blocks in step. */
:root[data-theme='light'] {
  --tm-bg-base: #f0f0f5;
  --tm-bg-surface: #e8e8f0;
  --tm-bg-elevated: #ffffff;
  --tm-bg-card: #f5f5fa;
  --tm-bg-card-hover: #eaeaf5;
  --tm-bg-input: #ffffff;
  --tm-text-primary: #1a1a2e;
  --tm-text-secondary: #555580;
  --tm-text-muted: #5c5c94;
  --tm-border: rgba(0,0,0,0.08);
  --tm-border-strong: rgba(0,0,0,0.15);
  --tm-accent: #4a57a8;
  --tm-on-accent: #ffffff;
  --tm-accent-text: #4a57a8;
  --tm-accent-hover: #3d4890;
  --tm-accent-dim: rgba(74,87,168,0.12);
  --tm-accent-glow: rgba(74,87,168,0.28);
  --tm-danger: #962d20;
  --tm-success: #0f5c2a;
  --tm-warning: #a85a00;
  --tm-diff-added-bg: rgba(15,92,42,0.10);
  --tm-diff-removed-bg: rgba(150,45,32,0.10);
  --tm-syntax-comment: #5c5c94;
  --tm-syntax-keyword: #8a3fa8;
  --tm-syntax-string: #0f5c2a;
  --tm-syntax-tag: #962d20;
  --tm-syntax-literal: #0e6e7a;
  --tm-syntax-number: #8a5417;
  --tm-syntax-title: #1d5fa8;
  --tm-syntax-attribute: #7a5c12;
  --tm-overlay-subtle: rgba(0,0,0,0.03);
  --tm-overlay-soft: rgba(0,0,0,0.05);
  --tm-overlay: rgba(0,0,0,0.07);
  --tm-overlay-strong: rgba(0,0,0,0.12);
  --tm-scrim: rgba(0,0,0,0.35);
  --tm-on-success: #ffffff;
  --tm-on-warning: #ffffff;
  --tm-on-danger: #ffffff;
}
*, *::before, *::after { box-sizing: border-box; }
html, body {
  width: 100%; height: 100%; margin: 0; padding: 0;
  background: var(--tm-bg-base);
  color: var(--tm-text-primary);
  font-family: var(--tm-font-ui);
  /* The product's size, not the browser's.

     This set a family, a colour and a background and no size, so anything that
     forgot one landed on 16px beside a product drawn at 11-13px. Not a rare
     mistake: an extension's every heading, every bold span inside a button,
     every label whose rule happened to omit it. One view read as three type
     scales at once, and every instance had to be found by eye.

     A default that is right is the fix; a rule that wants larger still says
     so. */
  font-size: 13px;
  line-height: 1.45;
  -webkit-font-smoothing: antialiased;
}
#app { width: 100%; height: 100%; display: flex; flex-direction: column; }
/* Checkboxes — extension views are isolated WebContentsViews and inherit none
   of the host's CSS, so the same replacement the core applies is injected here.
   Without it an extension's checkbox is a white OS widget on a dark panel. */
input[type='checkbox'] {
  appearance: none; -webkit-appearance: none; position: relative; flex-shrink: 0;
  width: 14px; height: 14px; margin: 0; padding: 0;
  border: 1px solid var(--tm-border-strong); border-radius: 3px;
  background: var(--tm-bg-input); cursor: pointer;
  transition: background-color 0.12s ease, border-color 0.12s ease;
}
input[type='checkbox']:hover:not(:disabled) { border-color: var(--tm-accent); }
input[type='checkbox']:checked, input[type='checkbox']:indeterminate {
  background: var(--tm-accent); border-color: var(--tm-accent);
}
input[type='checkbox']:checked::after {
  content: ''; position: absolute; left: 4px; top: 1px; width: 4px; height: 8px;
  border: solid var(--tm-on-accent); border-width: 0 2px 2px 0; transform: rotate(45deg);
}
input[type='checkbox']:indeterminate::after {
  content: ''; position: absolute; left: 2px; top: 5px; width: 8px; height: 2px;
  border-radius: 1px; background: var(--tm-on-accent);
}
input[type='checkbox']:focus-visible { outline: 2px solid var(--tm-accent-glow); outline-offset: 1px; }
input[type='checkbox']:disabled { cursor: default; opacity: 0.4; }
/* Radios: same box, circular, dot instead of a tick. left/top 3px centres a 6px
   dot in the 12px padding box of a 14px border-box with a 1px border. */
input[type='radio'] {
  appearance: none; -webkit-appearance: none; position: relative; flex-shrink: 0;
  width: 14px; height: 14px; margin: 0; padding: 0;
  border: 1px solid var(--tm-border-strong); border-radius: 50%;
  background: var(--tm-bg-input); cursor: pointer;
  transition: background-color 0.12s ease, border-color 0.12s ease;
}
input[type='radio']:hover:not(:disabled) { border-color: var(--tm-accent); }
input[type='radio']:checked { background: var(--tm-accent); border-color: var(--tm-accent); }
input[type='radio']:checked::after {
  content: ''; position: absolute; left: 3px; top: 3px; width: 6px; height: 6px;
  border-radius: 50%; background: var(--tm-on-accent);
}
input[type='radio']:focus-visible { outline: 2px solid var(--tm-accent-glow); outline-offset: 1px; }
input[type='radio']:disabled { cursor: default; opacity: 0.4; }
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
