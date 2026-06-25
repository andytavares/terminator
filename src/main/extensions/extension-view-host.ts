import { WebContentsView, session as electronSession } from 'electron'
import type { BrowserWindow } from 'electron'
import type { Extension } from '../../shared/types/index.js'
import { makeLogger } from '../logger.js'

const logger = makeLogger('extension-view-host')

// Injected into every extension WebContentsView so --tm-* CSS variables are defined.
// Extensions use these to match the app's dark theme without sharing the main renderer context.
const EXTENSION_BASE_CSS = `
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
}

export class ExtensionViewHost {
  private views = new Map<string, ViewEntry[]>()
  private mainWindow: BrowserWindow
  private preloadPath: string

  constructor(mainWindow: BrowserWindow, preloadPath: string) {
    this.mainWindow = mainWindow
    this.preloadPath = preloadPath
  }

  async createView(ext: Extension, viewParam: string): Promise<void> {
    if (!ext.rendererUrl) return

    const url = buildUrl(ext.rendererUrl, viewParam)
    const view = new WebContentsView({
      webPreferences: {
        session: electronSession.fromPartition('ext-views'),
        preload: this.preloadPath,
        contextIsolation: true,
        nodeIntegration: false,
      },
    })

    view.webContents.on('did-finish-load', () => {
      view.webContents.insertCSS(EXTENSION_BASE_CSS).catch(() => {})
      this.mainWindow.webContents.send('extension:panel-loaded', { id: ext.id, viewParam })
    })

    try {
      await view.webContents.loadURL(url)
    } catch (e) {
      logger.warn(`Failed to load ${url}: ${e instanceof Error ? e.message : String(e)}`)
    }

    this.mainWindow.contentView.addChildView(view)

    const existing = this.views.get(ext.id) ?? []
    this.views.set(ext.id, [...existing, { view, extensionId: ext.id, viewParam }])
  }

  destroyAllViews(extensionId: string): void {
    const entries = this.views.get(extensionId)
    if (!entries) return
    for (const { view } of entries) {
      this.mainWindow.contentView.removeChildView(view)
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
    visible: boolean
  ): void {
    const entries = this.views.get(extensionId)
    if (!entries) return
    const entry = entries.find((e) => e.viewParam === viewParam)
    if (!entry) return

    // setBounds uses logical pixels (CSS px) — no DPR scaling needed.
    entry.view.setBounds({
      x: Math.round(bounds.x),
      y: Math.round(bounds.y),
      width: Math.round(bounds.width),
      height: Math.round(bounds.height),
    })
    entry.view.setVisible(visible)
  }

  broadcastToAll(channel: string, data: unknown): void {
    for (const entries of this.views.values()) {
      for (const { view } of entries) {
        view.webContents.send(channel, data)
      }
    }
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

function buildUrl(rendererUrl: string, viewParam: string): string {
  const url = new URL(rendererUrl)
  if (viewParam) url.searchParams.set('view', viewParam)
  return url.toString()
}
