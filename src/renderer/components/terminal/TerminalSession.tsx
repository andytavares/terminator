import { Terminal, IBufferCell } from 'xterm'
import { FitAddon } from 'xterm-addon-fit'
import 'xterm/css/xterm.css'
import { useSessionStore } from '../../stores/session.store'

const IDLE_DEBOUNCE_MS = 1500

// 16-color ANSI palette matching xterm's default theme
const ANSI_COLORS = [
  '#000000',
  '#cd3131',
  '#0dbc79',
  '#e5e510',
  '#2472c8',
  '#bc3fbc',
  '#11a8cd',
  '#e5e5e5',
  '#666666',
  '#f14c4c',
  '#23d18b',
  '#f5f543',
  '#3b8eea',
  '#d670d6',
  '#29b8db',
  '#e5e5e5',
]

function ansiColorToCss(color: number, defaultCss: string): string {
  if (color === -1 || color === undefined) return defaultCss
  // 0–15: standard ANSI palette
  if (color < 16) return ANSI_COLORS[color] ?? defaultCss
  // 16–231: 6×6×6 cube
  if (color < 232) {
    const c = color - 16
    const b = c % 6,
      g = Math.floor(c / 6) % 6,
      r = Math.floor(c / 36)
    const v = (n: number) => (n ? 55 + n * 40 : 0)
    return `rgb(${v(r)},${v(g)},${v(b)})`
  }
  // 232–255: greyscale
  const grey = 8 + (color - 232) * 10
  return `rgb(${grey},${grey},${grey})`
}

export class TerminalInstance {
  terminal: Terminal
  private fitAddon: FitAddon
  private outputUnsubscribe: (() => void) | null = null
  private resizeObserver: ResizeObserver | null = null
  private opened = false
  private sessionId: string
  private busyTimer: ReturnType<typeof setTimeout> | null = null

  // The root element xterm renders into — created on first mount(), moved between containers.
  readonly element: HTMLDivElement
  // Snapshot captured in unmount() so Overview can display it after the element is detached.
  lastSnapshot: string | null = null

  constructor(sessionId: string, scrollbackLimit: number, onBell?: () => void) {
    this.sessionId = sessionId
    this.terminal = new Terminal({
      scrollback: scrollbackLimit,
      fontFamily: 'Menlo, Monaco, "Courier New", monospace',
      fontSize: 13,
      theme: {
        background: '#1e1e1e',
        foreground: '#cccccc',
      },
      cursorBlink: true,
    })
    this.fitAddon = new FitAddon()
    this.terminal.loadAddon(this.fitAddon)

    this.element = document.createElement('div')
    this.element.style.cssText = 'width:100%;height:100%;'

    this.terminal.attachCustomKeyEventHandler((e) => {
      // Cmd+Enter / Shift+Enter — send a literal newline to the running program.
      // terminal.paste() wraps in bracketed-paste sequences when the program has enabled
      // that mode (e.g. claude CLI), so the program receives a newline without executing.
      // Note: Shift+Enter is intercepted unconditionally — programs that handle it
      // natively (e.g. IPython) will not receive the raw key event.
      if ((e.metaKey || e.shiftKey) && e.key === 'Enter' && e.type === 'keydown') {
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

    if (onBell) {
      this.terminal.onBell(onBell)
    }

    this.outputUnsubscribe = window.electronAPI.terminal.onOutput((sid, data) => {
      if (sid !== sessionId) return
      this.terminal.write(data)
      useSessionStore.getState().setSessionBusy(sessionId)
      if (this.busyTimer !== null) clearTimeout(this.busyTimer)
      this.busyTimer = setTimeout(() => {
        this.busyTimer = null
        useSessionStore.getState().setSessionIdle(sessionId)
      }, IDLE_DEBOUNCE_MS)
    })
  }

  // Call once after the element is in a visible, sized container.
  mount(container: HTMLElement): void {
    container.appendChild(this.element)
    if (!this.opened) {
      this.terminal.open(this.element)
      this.opened = true
    }
    this.fitAddon.fit()
    this.terminal.scrollToBottom()
    this.terminal.focus()
    this.resizeObserver = new ResizeObserver(() => this.fitAddon.fit())
    this.resizeObserver.observe(container)
  }

  // Mount the live xterm element into a preview container (e.g. an Overview tile).
  // Scales the element to fit the container without sending a PTY resize event.
  // Returns a cleanup function that restores the element and removes it from the container.
  mountPreview(container: HTMLElement): (() => void) | null {
    if (!this.opened) return null
    const { cols, rows } = this.terminal
    if (!cols || !rows) return null

    // Compute natural pixel dimensions using the same font metrics as captureToDataUrl.
    const fontSize = 13
    const lineHeight = Math.ceil(fontSize * 1.2)
    let charW = 8 // fallback if canvas measurement is unavailable
    const measureCanvas = document.createElement('canvas')
    const mctx = measureCanvas.getContext('2d')
    if (mctx) {
      mctx.font = `${fontSize}px Menlo, Monaco, "Courier New", monospace`
      charW = mctx.measureText('M').width || charW
    }
    const naturalW = Math.ceil(cols * charW + 12)
    const naturalH = rows * lineHeight + 8

    const containerW = container.offsetWidth || 220
    const containerH = container.offsetHeight || 150
    const scale = Math.min(containerW / naturalW, containerH / naturalH)

    this.element.style.width = `${naturalW}px`
    this.element.style.height = `${naturalH}px`
    this.element.style.transform = `scale(${scale})`
    this.element.style.transformOrigin = 'top left'
    this.element.style.pointerEvents = 'none'
    container.appendChild(this.element)

    return () => {
      this.element.style.width = '100%'
      this.element.style.height = '100%'
      this.element.style.transform = ''
      this.element.style.transformOrigin = ''
      this.element.style.pointerEvents = ''
      this.element.parentElement?.removeChild(this.element)
    }
  }

  // Render the terminal buffer to a canvas and return a JPEG data URL.
  // Uses xterm's buffer API so it works with the DOM renderer (no canvas addon needed).
  captureToDataUrl(): string | null {
    if (!this.opened) return null
    const { cols, rows } = this.terminal
    if (!cols || !rows) return null

    // Measure character dimensions using the same font xterm uses
    const fontSize = 13
    const lineHeight = Math.ceil(fontSize * 1.2)
    const measureCanvas = document.createElement('canvas')
    const mctx = measureCanvas.getContext('2d')
    if (!mctx) return null
    mctx.font = `${fontSize}px Menlo, Monaco, "Courier New", monospace`
    const charW = mctx.measureText('M').width

    const padX = 6
    const padY = 4
    const w = Math.ceil(cols * charW + padX * 2)
    const h = rows * lineHeight + padY * 2

    const canvas = document.createElement('canvas')
    canvas.width = w
    canvas.height = h
    const ctx = canvas.getContext('2d')
    if (!ctx) return null

    ctx.fillStyle = '#1e1e1e'
    ctx.fillRect(0, 0, w, h)
    ctx.font = `${fontSize}px Menlo, Monaco, "Courier New", monospace`

    const buffer = this.terminal.buffer.active
    const reusableCell: IBufferCell =
      this.terminal.buffer.active.getLine(0)?.getCell(0) ?? (null as unknown as IBufferCell)

    for (let row = 0; row < rows; row++) {
      const line = buffer.getLine(row)
      if (!line) continue
      const y = padY + (row + 1) * lineHeight - 2

      for (let col = 0; col < cols; col++) {
        const cell = line.getCell(col, reusableCell)
        if (!cell) continue

        // Draw background if not default
        const bg = cell.getBgColor()
        if (bg !== -1 && bg !== undefined) {
          const bgCss = ansiColorToCss(bg, '#1e1e1e')
          if (bgCss !== '#1e1e1e') {
            ctx.fillStyle = bgCss
            ctx.fillRect(padX + col * charW, padY + row * lineHeight, charW, lineHeight)
          }
        }

        const chars = cell.getChars()
        if (!chars || chars === ' ') continue

        const fg = cell.getFgColor()
        ctx.fillStyle = ansiColorToCss(fg, '#cccccc')
        if (cell.isBold()) ctx.font = `bold ${fontSize}px Menlo, Monaco, "Courier New", monospace`
        ctx.fillText(chars, padX + col * charW, y)
        if (cell.isBold()) ctx.font = `${fontSize}px Menlo, Monaco, "Courier New", monospace`
      }
    }

    return canvas.toDataURL('image/jpeg', 0.7)
  }

  // Remove from DOM without destroying the xterm instance.
  // Captures a snapshot first so Overview can display it while the terminal is unmounted.
  // Only updates lastSnapshot on success — never overwrites a valid snapshot with null.
  unmount(): void {
    const snapshot = this.captureToDataUrl()
    if (snapshot !== null) this.lastSnapshot = snapshot
    this.resizeObserver?.disconnect()
    this.resizeObserver = null
    this.element.parentElement?.removeChild(this.element)
  }

  dispose(): void {
    if (this.busyTimer !== null) {
      clearTimeout(this.busyTimer)
      this.busyTimer = null
    }
    useSessionStore.getState().setSessionIdle(this.sessionId)
    this.unmount()
    this.outputUnsubscribe?.()
    this.outputUnsubscribe = null
    this.terminal.dispose()
  }
}
