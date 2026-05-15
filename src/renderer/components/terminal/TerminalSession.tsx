import { Terminal } from 'xterm'
import { FitAddon } from 'xterm-addon-fit'
import 'xterm/css/xterm.css'

export class TerminalInstance {
  terminal: Terminal
  private fitAddon: FitAddon
  private outputUnsubscribe: (() => void) | null = null
  private resizeObserver: ResizeObserver | null = null
  private opened = false

  // The root element xterm renders into — created on first mount(), moved between containers.
  readonly element: HTMLDivElement

  constructor(sessionId: string, scrollbackLimit: number, onBell?: () => void) {
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
      if (sid === sessionId) this.terminal.write(data)
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

  // Remove from DOM without destroying the xterm instance.
  unmount(): void {
    this.resizeObserver?.disconnect()
    this.resizeObserver = null
    this.element.parentElement?.removeChild(this.element)
  }

  dispose(): void {
    this.unmount()
    this.outputUnsubscribe?.()
    this.outputUnsubscribe = null
    this.terminal.dispose()
  }
}
