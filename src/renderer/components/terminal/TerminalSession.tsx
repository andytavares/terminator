import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { WebglAddon } from '@xterm/addon-webgl'
import '@xterm/xterm/css/xterm.css'
import { previewWindow } from '../../terminal/preview-window'
import { subscribeToSessionOutput } from '../../terminal/output-router'
import { webglContexts } from '../../terminal/webgl-contexts'
import { LinkPointer } from '../../terminal/link-pointer'
import { registerLinkProviders as registerTerminalLinkProviders } from '../../terminal/terminal-links'
import { isQuickActionsLeader } from '../../../shared/quick-actions-leader'

const IDLE_DEBOUNCE_MS = 1500

// xterm 6 draws its own scrollbar, so the slider colours live in the theme, not CSS.
/** @internal */
export const XTERM_THEMES = {
  dark: {
    background: '#1e1e1e',
    foreground: '#cccccc',
    scrollbarSliderBackground: 'rgba(255, 255, 255, 0.18)',
    scrollbarSliderHoverBackground: 'rgba(255, 255, 255, 0.28)',
    scrollbarSliderActiveBackground: 'rgba(255, 255, 255, 0.4)',
  },
  light: {
    background: '#f5f5f5',
    foreground: '#1a1a1a',
    scrollbarSliderBackground: 'rgba(0, 0, 0, 0.18)',
    scrollbarSliderHoverBackground: 'rgba(0, 0, 0, 0.28)',
    scrollbarSliderActiveBackground: 'rgba(0, 0, 0, 0.4)',
  },
} as const

function isLeader(e: KeyboardEvent): boolean {
  const press = {
    key: e.key,
    meta: e.metaKey,
    control: e.ctrlKey,
    shift: e.shiftKey,
    alt: e.altKey,
  }
  return isQuickActionsLeader(press, navigator.platform.startsWith('Mac'))
}

function measureCharWidth(fontSize: number): number {
  const canvas = document.createElement('canvas')
  const ctx = canvas.getContext('2d')
  if (ctx) {
    ctx.font = `${fontSize}px Menlo, Monaco, "Courier New", monospace`
    return ctx.measureText('M').width || 8
  }
  return 8
}

const currentTheme = () =>
  document.documentElement.dataset.theme === 'light' ? XTERM_THEMES.light : XTERM_THEMES.dark

function createTerminal(
  scrollbackLimit: number,
  theme: (typeof XTERM_THEMES)[keyof typeof XTERM_THEMES]
): Terminal {
  return new Terminal({
    scrollback: scrollbackLimit,
    fontFamily: 'Menlo, Monaco, "Courier New", monospace',
    fontSize: 13,
    lineHeight: 1.2,
    theme,
    cursorBlink: true,
  })
}

/** Repaints the terminal in the app's theme whenever the theme changes. */
function followTheme(terminal: Terminal): MutationObserver {
  const observer = new MutationObserver(() => {
    terminal.options.theme = currentTheme()
  })
  observer.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ['data-theme'],
  })
  return observer
}

/** False for a key the terminal must not handle itself. */
function handleCustomKey(terminal: Terminal, e: KeyboardEvent): boolean {
  // The quick-actions leader belongs to the app. Off macOS it is Ctrl+P, which
  // xterm would send to the shell as ^P and stop from reaching the app's listener.
  if (isLeader(e)) return false
  // Cmd+Enter / Shift+Enter send a literal newline: paste() brackets it when the program asked
  // (claude CLI), so it is not executed. Shift+Enter is always taken, so a program that handles it
  // itself (IPython) never sees the raw key.
  if ((e.metaKey || e.shiftKey) && e.key === 'Enter' && e.type === 'keydown') {
    // Must call preventDefault() ourselves — xterm does NOT call it when the custom
    // handler returns false. Without this, the browser fires a subsequent `input` event
    // on xterm's textarea, which xterm forwards to the PTY as \r (submitting the line).
    e.preventDefault()
    terminal.paste('\n')
    return false
  }
  return true
}

const PREVIEW_FONT_SIZE = 13

/** The terminal's size in pixels at its own font, before a preview scales it. */
function naturalSize(cols: number, rows: number) {
  const lineHeight = Math.ceil(PREVIEW_FONT_SIZE * 1.2)
  const charW = measureCharWidth(PREVIEW_FONT_SIZE)
  return {
    lineHeight,
    naturalW: Math.ceil(cols * charW + 12),
    naturalH: rows * lineHeight + 8,
  }
}

/**
 * Activity callbacks wired by the session controller. TerminalInstance is a
 * pure view object: it emits these events and never touches a store.
 */
export interface TerminalInstanceHooks {
  onBell?: () => void
  onBusy?: () => void
  onIdle?: () => void
  onDispose?: () => void
}

export class TerminalInstance {
  terminal: Terminal
  private hooks?: TerminalInstanceHooks
  private fitAddon: FitAddon
  private webglAddon: WebglAddon | null = null
  private outputUnsubscribe: (() => void) | null = null
  private resizeObserver: ResizeObserver | null = null
  private linkPointer: LinkPointer | null = null
  private themeObserver: MutationObserver | null = null
  private opened = false
  private sessionId: string
  private busyTimer: ReturnType<typeof setTimeout> | null = null

  // The root element xterm renders into — created on first mount(), moved between containers.
  readonly element: HTMLDivElement
  // Underline overlay for hovered links — positioned absolutely inside this.element.
  linkOverlay: HTMLDivElement | null = null

  constructor(sessionId: string, scrollbackLimit: number, hooks?: TerminalInstanceHooks) {
    this.sessionId = sessionId
    this.hooks = hooks
    const initialTheme = currentTheme()
    this.terminal = createTerminal(scrollbackLimit, initialTheme)
    this.fitAddon = new FitAddon()
    this.terminal.loadAddon(this.fitAddon)
    this.terminal.options.theme = initialTheme
    this.themeObserver = followTheme(this.terminal)

    this.element = document.createElement('div')
    this.element.style.cssText = 'width:100%;height:100%;position:relative;'

    this.terminal.attachCustomKeyEventHandler((e) => handleCustomKey(this.terminal, e))
    this.wireToPty(sessionId)
    this.registerLinkProviders()
    this.outputUnsubscribe = this.subscribeToOutput(sessionId)

    // Subscribed first, then attached: what the process printed before this terminal was on screen
    // was held and arrives now. Without it a terminal the app opened (a supervised agent) would
    // miss its launch command and all output up to the moment it appeared.
    void window.electronAPI.terminal.attach(sessionId)
  }

  /** Keystrokes and size go to the PTY; the bell goes to whoever asked to hear it. */
  private wireToPty(sessionId: string): void {
    this.terminal.onData((data) => {
      window.electronAPI.terminal.input(sessionId, data)
    })

    this.terminal.onResize(({ cols, rows }) => {
      window.electronAPI.terminal.resize(sessionId, cols, rows)
    })

    if (this.hooks?.onBell) {
      this.terminal.onBell(this.hooks.onBell)
    }
  }

  /** Writes the session's output, reporting busy on each chunk and idle once it stops. */
  private subscribeToOutput(sessionId: string): () => void {
    return subscribeToSessionOutput(sessionId, (data, written) => {
      this.terminal.write(data, written)
      this.hooks?.onBusy?.()
      if (this.busyTimer !== null) clearTimeout(this.busyTimer)
      this.busyTimer = setTimeout(() => {
        this.busyTimer = null
        this.hooks?.onIdle?.()
      }, IDLE_DEBOUNCE_MS)
    })
  }

  private registerLinkProviders(): void {
    registerTerminalLinkProviders(this.terminal)
    this.linkPointer = new LinkPointer(this.terminal, this.element)
    this.linkOverlay = this.linkPointer.overlay
  }

  // A visible terminal draws on the GPU. Without a context to spare, or when the
  // GPU refuses one, it keeps xterm's DOM renderer.
  private enableWebgl(): void {
    if (this.webglAddon || !webglContexts.acquire(this.sessionId)) return
    try {
      const addon = new WebglAddon()
      addon.onContextLoss(() => this.disableWebgl())
      this.terminal.loadAddon(addon)
      this.webglAddon = addon
    } catch {
      webglContexts.releaseContext(this.sessionId)
    }
  }

  private disableWebgl(): void {
    this.webglAddon?.dispose()
    this.webglAddon = null
    webglContexts.releaseContext(this.sessionId)
  }

  // Call once after the element is in a visible, sized container.
  mount(container: HTMLElement): void {
    container.appendChild(this.element)
    if (!this.opened) {
      this.terminal.open(this.element)
      this.opened = true
    }
    this.enableWebgl()
    this.fitAddon.fit()
    this.terminal.focus()
    // Detaching/reattaching the element on tab switch (ADR-004) resets the
    // scrollable viewport to the top, so re-pin to the latest output once the
    // reattached element has laid out. While a tab is visible xterm follows
    // output natively (and honours the user scrolling up) — we only re-establish
    // "following" when the tab becomes visible again.
    // Moving the element between containers on tab switch (ADR-004) resets the
    // DOM viewport's scrollTop to 0 while xterm's internal scroll position is
    // unchanged — they desync, and scrollToBottom() is a no-op because xterm
    // already believes it is at the bottom. Nudge the scroll position by one line
    // (which forces xterm to re-sync the DOM viewport) and then pin to the bottom.
    // While a tab is visible xterm follows output natively and honours the user
    // scrolling up; we only re-establish "following" when the tab reappears.
    requestAnimationFrame(() => {
      this.terminal.scrollLines(-1)
      this.terminal.scrollToBottom()
    })
    this.resizeObserver = new ResizeObserver(() => this.fitAddon.fit())
    this.resizeObserver.observe(container)
  }

  // Mount the live xterm element into a preview container (e.g. an Overview tile).
  // Scales the element to fit the container without sending a PTY resize event.
  // Returns a cleanup function that restores the element and removes it from the container.
  /** The rows currently on screen, top to bottom, each trimmed on the right. */
  readVisibleRows(): string[] {
    const { buffer, rows } = this.terminal
    const top = buffer.active.viewportY
    return Array.from(
      { length: rows },
      (_, i) => buffer.active.getLine(top + i)?.translateToString(true) ?? ''
    )
  }

  /** The cursor's row on screen, 0 at the top. */
  cursorRow(): number {
    return this.terminal.buffer.active.cursorY
  }

  mountPreview(container: HTMLElement): (() => void) | null {
    if (!this.opened) return null
    const { cols, rows } = this.terminal
    if (!cols || !rows) return null
    const size = naturalSize(cols, rows)

    const place = (): void => {
      const { scale, translateY } = previewWindow({
        rows,
        cursorY: this.terminal.buffer.active.cursorY,
        ...size,
        containerW: container.offsetWidth || 220,
        containerH: container.offsetHeight || 150,
      })
      this.element.style.transform = `translateY(${translateY}px) scale(${scale})`
    }

    // A tile is a scaled thumbnail of a live terminal; it never takes a GPU context.
    this.disableWebgl()
    this.styleAsPreview(size)
    place()
    container.appendChild(this.element)
    // The cursor moves as output arrives; the window follows it on each render.
    const following = this.terminal.onRender(place)

    return () => {
      following.dispose()
      this.restoreFromPreview()
    }
  }

  private styleAsPreview({ naturalW, naturalH }: { naturalW: number; naturalH: number }): void {
    this.element.style.width = `${naturalW}px`
    this.element.style.height = `${naturalH}px`
    this.element.style.transformOrigin = 'top left'
    this.element.style.pointerEvents = 'none'
    // A preview is for reading. Its xterm input stays out of the tab order, or
    // tabbing through Home would type into the session behind a thumbnail.
    this.terminal.textarea?.setAttribute('tabindex', '-1')
  }

  private restoreFromPreview(): void {
    this.terminal.textarea?.removeAttribute('tabindex')
    this.element.style.width = '100%'
    this.element.style.height = '100%'
    this.element.style.transform = ''
    this.element.style.transformOrigin = ''
    this.element.style.pointerEvents = ''
    this.element.parentElement?.removeChild(this.element)
  }

  // Remove from DOM without destroying the xterm instance.
  unmount(): void {
    this.disableWebgl()
    this.resizeObserver?.disconnect()
    this.resizeObserver = null
    this.element.parentElement?.removeChild(this.element)
  }

  getSelection(): string {
    return this.terminal.getSelection()
  }

  dispose(): void {
    if (this.busyTimer !== null) {
      clearTimeout(this.busyTimer)
      this.busyTimer = null
    }
    this.themeObserver?.disconnect()
    this.themeObserver = null
    this.linkPointer?.dispose()
    this.linkPointer = null
    this.linkOverlay = null
    this.hooks?.onIdle?.()
    this.hooks?.onDispose?.()
    this.unmount()
    this.outputUnsubscribe?.()
    this.outputUnsubscribe = null
    this.terminal.dispose()
  }
}
