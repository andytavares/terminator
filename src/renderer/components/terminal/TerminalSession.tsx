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
    const initialTheme =
      document.documentElement.dataset.theme === 'light' ? XTERM_THEMES.light : XTERM_THEMES.dark
    this.terminal = new Terminal({
      scrollback: scrollbackLimit,
      fontFamily: 'Menlo, Monaco, "Courier New", monospace',
      fontSize: 13,
      lineHeight: 1.2,
      theme: initialTheme,
      cursorBlink: true,
    })
    this.fitAddon = new FitAddon()
    this.terminal.loadAddon(this.fitAddon)
    this.terminal.options.theme = initialTheme
    this.themeObserver = new MutationObserver(() => {
      this.terminal.options.theme =
        document.documentElement.dataset.theme === 'light' ? XTERM_THEMES.light : XTERM_THEMES.dark
    })
    this.themeObserver.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['data-theme'],
    })

    this.element = document.createElement('div')
    this.element.style.cssText = 'width:100%;height:100%;position:relative;'

    this.terminal.attachCustomKeyEventHandler((e) => {
      // The quick-actions leader belongs to the app. Off macOS it is Ctrl+P, which
      // xterm would send to the shell as ^P and stop from reaching the app's listener.
      if (isLeader(e)) return false
      // Cmd+Enter / Shift+Enter — send a literal newline to the running program.
      // terminal.paste() wraps in bracketed-paste sequences when the program has enabled
      // that mode (e.g. claude CLI), so the program receives a newline without executing.
      // Note: Shift+Enter is intercepted unconditionally — programs that handle it
      // natively (e.g. IPython) will not receive the raw key event.
      if ((e.metaKey || e.shiftKey) && e.key === 'Enter' && e.type === 'keydown') {
        // Must call preventDefault() ourselves — xterm does NOT call it when the custom
        // handler returns false. Without this, the browser fires a subsequent `input` event
        // on xterm's textarea, which xterm forwards to the PTY as \r (submitting the line).
        e.preventDefault()
        this.terminal.paste('\n')
        return false
      }
      return true
    })

    this.terminal.onData((data) => {
      window.electronAPI.terminal.input(sessionId, data)
    })

    this.terminal.onResize(({ cols, rows }) => {
      window.electronAPI.terminal.resize(sessionId, cols, rows)
    })

    if (hooks?.onBell) {
      this.terminal.onBell(hooks.onBell)
    }

    this.registerLinkProviders()

    this.outputUnsubscribe = subscribeToSessionOutput(sessionId, (data, written) => {
      this.terminal.write(data, written)
      this.hooks?.onBusy?.()
      if (this.busyTimer !== null) clearTimeout(this.busyTimer)
      this.busyTimer = setTimeout(() => {
        this.busyTimer = null
        this.hooks?.onIdle?.()
      }, IDLE_DEBOUNCE_MS)
    })

    // Subscribed first, then attached: anything the process printed before this
    // terminal existed on screen has been held back, and is delivered now. A
    // terminal the operator opened themselves has nothing held and this is a
    // no-op; one the application opened — a supervised agent — would otherwise
    // be missing its launch command and everything up to the moment it appeared.
    void window.electronAPI.terminal.attach(sessionId)
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
      webglContexts.release(this.sessionId)
    }
  }

  private disableWebgl(): void {
    this.webglAddon?.dispose()
    this.webglAddon = null
    webglContexts.release(this.sessionId)
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

    // Compute natural pixel dimensions using the same font metrics as the terminal.
    const fontSize = 13
    const lineHeight = Math.ceil(fontSize * 1.2)
    const charW = measureCharWidth(fontSize)
    const naturalW = Math.ceil(cols * charW + 12)
    const naturalH = rows * lineHeight + 8

    const place = (): void => {
      const { scale, translateY } = previewWindow({
        rows,
        cursorY: this.terminal.buffer.active.cursorY,
        lineHeight,
        naturalW,
        naturalH,
        containerW: container.offsetWidth || 220,
        containerH: container.offsetHeight || 150,
      })
      this.element.style.transform = `translateY(${translateY}px) scale(${scale})`
    }

    // A tile is a scaled thumbnail of a live terminal; it never takes a GPU context.
    this.disableWebgl()
    this.element.style.width = `${naturalW}px`
    this.element.style.height = `${naturalH}px`
    this.element.style.transformOrigin = 'top left'
    this.element.style.pointerEvents = 'none'
    // A preview is for reading. Its xterm input stays out of the tab order, or
    // tabbing through Home would type into the session behind a thumbnail.
    this.terminal.textarea?.setAttribute('tabindex', '-1')
    place()
    container.appendChild(this.element)
    // The cursor moves as output arrives; the window follows it on each render.
    const following = this.terminal.onRender(place)

    return () => {
      following.dispose()
      this.terminal.textarea?.removeAttribute('tabindex')
      this.element.style.width = '100%'
      this.element.style.height = '100%'
      this.element.style.transform = ''
      this.element.style.transformOrigin = ''
      this.element.style.pointerEvents = ''
      this.element.parentElement?.removeChild(this.element)
    }
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
