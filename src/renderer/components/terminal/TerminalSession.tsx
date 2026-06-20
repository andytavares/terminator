import { Terminal, IBufferCell, ILinkProvider, ILink } from 'xterm'
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

function measureCharWidth(fontSize: number): number {
  const canvas = document.createElement('canvas')
  const ctx = canvas.getContext('2d')
  if (ctx) {
    ctx.font = `${fontSize}px Menlo, Monaco, "Courier New", monospace`
    return ctx.measureText('M').width || 8
  }
  return 8
}

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
  private cmdClickCleanup: (() => void) | null = null
  private opened = false
  private sessionId: string
  private busyTimer: ReturnType<typeof setTimeout> | null = null
  private scrollToBottomOnMount: boolean

  // The root element xterm renders into — created on first mount(), moved between containers.
  readonly element: HTMLDivElement
  // Underline overlay for hovered links — positioned absolutely inside this.element.
  linkOverlay: HTMLDivElement | null = null
  // Snapshot captured in unmount() so Overview can display it after the element is detached.
  lastSnapshot: string | null = null

  constructor(
    sessionId: string,
    scrollbackLimit: number,
    scrollToBottomOnMount: boolean,
    onBell?: () => void
  ) {
    this.sessionId = sessionId
    this.scrollToBottomOnMount = scrollToBottomOnMount
    this.terminal = new Terminal({
      scrollback: scrollbackLimit,
      fontFamily: 'Menlo, Monaco, "Courier New", monospace',
      fontSize: 13,
      lineHeight: 1.2,
      theme: {
        background: '#1e1e1e',
        foreground: '#cccccc',
      },
      cursorBlink: true,
    })
    this.fitAddon = new FitAddon()
    this.terminal.loadAddon(this.fitAddon)

    this.element = document.createElement('div')
    this.element.style.cssText = 'width:100%;height:100%;position:relative;'

    this.terminal.attachCustomKeyEventHandler((e) => {
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

    if (onBell) {
      this.terminal.onBell(onBell)
    }

    this.registerLinkProviders()

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

  private registerLinkProviders(): void {
    const urlRegex = /https?:\/\/(?:[^\s()>\]'"\\]|\([^\s()>\]'"\\]*\))+/g
    // www. prefix URLs without a protocol (opened with https:// prepended)
    const bareUrlRegex = /\bwww\.[a-zA-Z0-9][a-zA-Z0-9\-.]*\.[a-zA-Z]{2,}(?:\/[^\s()>\]'"\\]*)?/g
    // Bare domain URLs like google.com or sub.example.io — TLD allowlist avoids false positives
    // on source file extensions (.js, .ts, .tsx, .py, etc.)
    const nakedUrlRegex =
      /\b(?!www\.)(?:[a-zA-Z0-9][a-zA-Z0-9-]*\.)+(?:com|net|org|io|dev|app|ai|sh|co|uk|me|tv|info|edu|gov|mil|eu|us|de|fr|jp|cn|au|in|nl|br|ru|it|es|ca|mx|ar|nz|za|sg|hk|kr|se|no|dk|fi|pl|at|ch|pt|gr|tr|be|xyz|tech|cloud|id|cc|biz|pro|media|live|link|site|run|codes|page|studio|zone|digital|pub)(?:\/[^\s()>\]'"\\]*)?/g
    const pathRegex = /(?<!\S)((?:~\/|\/(?!\/))[^\s:)>\]'"\\]+(?::\d+(?::\d+)?)?)/g
    // Matches paths inside " or ' to support spaces: File "/Users/Jane Doe/foo.py", line 5
    const quotedPathRegex = /(?:"((?:~\/|\/(?!\/))[^"]+)"|'((?:~\/|\/(?!\/))[^']+)')/g
    const fontSize = 13
    const lineHeight = Math.ceil(fontSize * 1.2)
    const charW = measureCharWidth(fontSize)

    // xterm computes its actual cell height from real font metrics after rendering;
    // it differs from our formula. We lazy-read it from the DOM on first use and cache it.
    let cachedCellH: number | null = null
    const getCellH = (): number => {
      if (cachedCellH !== null) return cachedCellH
      const rowsEl = this.terminal.element?.querySelector('.xterm-rows')
      const firstRow = rowsEl?.firstElementChild as HTMLElement | null
      if (firstRow) {
        const h = firstRow.getBoundingClientRect().height
        if (h > 0) cachedCellH = h
      }
      return cachedCellH ?? lineHeight
    }

    // xterm link providers: declare links for accessibility tooling only (no visual decorations —
    // visual feedback is handled by our own overlay and is cmd-key gated).
    const makeVisualProvider = (regex: RegExp): ILinkProvider => ({
      provideLinks: (bufferLineIndex, callback) => {
        const line = this.terminal.buffer.active.getLine(bufferLineIndex)
        if (!line) {
          callback(undefined)
          return
        }
        const text = line.translateToString(true)
        const links: ILink[] = []
        regex.lastIndex = 0
        let match: RegExpExecArray | null
        while ((match = regex.exec(text)) !== null) {
          const matchText = match[0]
          links.push({
            range: {
              start: { x: match.index + 1, y: bufferLineIndex + 1 },
              end: { x: match.index + matchText.length, y: bufferLineIndex + 1 },
            },
            text: matchText,
            activate: () => {},
          })
        }
        callback(links.length ? links : undefined)
      },
    })
    // Quoted-path provider: range covers inner path text only (excludes quote chars).
    const quotedPathProvider: ILinkProvider = {
      provideLinks: (bufferLineIndex, callback) => {
        const line = this.terminal.buffer.active.getLine(bufferLineIndex)
        if (!line) {
          callback(undefined)
          return
        }
        const text = line.translateToString(true)
        const links: ILink[] = []
        quotedPathRegex.lastIndex = 0
        let match: RegExpExecArray | null
        while ((match = quotedPathRegex.exec(text)) !== null) {
          const inner = match[1] ?? match[2]
          const innerStart = match.index + 1
          links.push({
            range: {
              start: { x: innerStart + 1, y: bufferLineIndex + 1 },
              end: { x: innerStart + inner.length, y: bufferLineIndex + 1 },
            },
            text: inner,
            activate: () => {},
          })
        }
        callback(links.length ? links : undefined)
      },
    }
    this.terminal.registerLinkProvider(makeVisualProvider(urlRegex))
    this.terminal.registerLinkProvider(makeVisualProvider(bareUrlRegex))
    this.terminal.registerLinkProvider(makeVisualProvider(nakedUrlRegex))
    this.terminal.registerLinkProvider(makeVisualProvider(pathRegex))
    this.terminal.registerLinkProvider(quotedPathProvider)

    // Underline overlay: a 1px div positioned absolutely under hovered link text.
    // Only shown when Cmd (macOS) or Ctrl (Win/Linux) is held.
    const overlay = document.createElement('div')
    overlay.style.cssText =
      'position:absolute;pointer-events:none;height:1px;background:#4a9eff;display:none;z-index:10;'
    this.element.appendChild(overlay)
    this.linkOverlay = overlay

    type HitResult = { index: number; length: number; text: string }

    // Hit-test a column position; returns normalised { index, length, text } for overlay/open.
    // Quoted paths expose the inner bounds (excluding quote chars).
    const hitTest = (text: string, col: number): HitResult | null => {
      for (const re of [urlRegex, bareUrlRegex, nakedUrlRegex, pathRegex]) {
        re.lastIndex = 0
        let m: RegExpExecArray | null
        while ((m = re.exec(text)) !== null) {
          if (col >= m.index && col < m.index + m[0].length)
            return { index: m.index, length: m[0].length, text: m[0] }
        }
      }
      quotedPathRegex.lastIndex = 0
      let m: RegExpExecArray | null
      while ((m = quotedPathRegex.exec(text)) !== null) {
        const inner = m[1] ?? m[2]
        const innerStart = m.index + 1
        if (col >= innerStart && col < innerStart + inner.length)
          return { index: innerStart, length: inner.length, text: inner }
      }
      return null
    }

    const isMac = navigator.platform.startsWith('Mac')

    const getPos = (e: MouseEvent) => {
      const rect = this.element.getBoundingClientRect()
      const col = Math.floor((e.clientX - rect.left) / charW)
      // Use the actual rendered cell height for row calculation so the hit zone
      // matches the visual rows even when the font renders taller than our formula.
      const viewportRow = Math.floor((e.clientY - rect.top) / getCellH())
      return { col, viewportRow, bufferRow: this.terminal.buffer.active.viewportY + viewportRow }
    }

    // Show overlay under the link at the given position.
    // We read the actual row element's bottom from the DOM so the underline lands
    // exactly below the descenders regardless of the font's true cell height.
    const showOverlayAt = (col: number, viewportRow: number, bufferRow: number) => {
      const line = this.terminal.buffer.active.getLine(bufferRow)
      const match = line ? hitTest(line.translateToString(true), col) : null
      if (match) {
        const rowsEl = this.terminal.element?.querySelector('.xterm-rows')
        const rowEl = rowsEl?.children[viewportRow] as HTMLElement | null
        const elRect = this.element.getBoundingClientRect()
        const top = rowEl
          ? rowEl.getBoundingClientRect().bottom - elRect.top - 1
          : (viewportRow + 1) * getCellH() - 1
        overlay.style.left = `${match.index * charW}px`
        overlay.style.top = `${top}px`
        overlay.style.width = `${match.length * charW}px`
        overlay.style.display = 'block'
        this.terminal.element?.classList.add('xterm-cursor-pointer')
      } else {
        this.clearLinkHover()
      }
    }

    // Last known mouse position (needed to re-check when cmd is pressed while hovering).
    let lastPos: { col: number; viewportRow: number; bufferRow: number } | null = null

    // mousemove: only show overlay when Cmd/Ctrl is held.
    const onMouseMove = (e: MouseEvent) => {
      const pos = getPos(e)
      lastPos = pos
      if (isMac ? e.metaKey : e.ctrlKey) {
        showOverlayAt(pos.col, pos.viewportRow, pos.bufferRow)
      } else {
        this.clearLinkHover()
      }
    }

    const onMouseLeave = () => {
      lastPos = null
      this.clearLinkHover()
    }

    // keydown/keyup on document: show/hide overlay when Cmd is pressed/released while hovering.
    const onKeyDown = (e: KeyboardEvent) => {
      const isModKey = isMac ? e.key === 'Meta' : e.key === 'Control'
      if (!isModKey || !lastPos) return
      // Recompute bufferRow from current viewportY — scroll since last mousemove would make the
      // cached lastPos.bufferRow point at the wrong line.
      const currentBufferRow = this.terminal.buffer.active.viewportY + lastPos.viewportRow
      showOverlayAt(lastPos.col, lastPos.viewportRow, currentBufferRow)
    }
    const onKeyUp = (e: KeyboardEvent) => {
      const isModKey = isMac ? e.key === 'Meta' : e.key === 'Control'
      if (isModKey) this.clearLinkHover()
    }
    document.addEventListener('keydown', onKeyDown)
    document.addEventListener('keyup', onKeyUp)

    // mousedown: Cmd+click (macOS) or Ctrl+click (Windows/Linux) opens links.
    // On macOS Ctrl+click is a secondary click — don't intercept it.
    const onMouseDown = (e: MouseEvent) => {
      if (!(isMac ? e.metaKey : e.ctrlKey)) return
      const { col, bufferRow } = getPos(e)
      const line = this.terminal.buffer.active.getLine(bufferRow)
      if (!line) return
      const text = line.translateToString(true)

      urlRegex.lastIndex = 0
      let m: RegExpExecArray | null
      while ((m = urlRegex.exec(text)) !== null) {
        if (col >= m.index && col < m.index + m[0].length) {
          e.preventDefault()
          window.electronAPI.shell.openExternal(m[0]).catch(() => {})
          return
        }
      }
      for (const re of [bareUrlRegex, nakedUrlRegex]) {
        re.lastIndex = 0
        while ((m = re.exec(text)) !== null) {
          if (col >= m.index && col < m.index + m[0].length) {
            e.preventDefault()
            window.electronAPI.shell.openExternal(`https://${m[0]}`).catch(() => {})
            return
          }
        }
      }
      pathRegex.lastIndex = 0
      while ((m = pathRegex.exec(text)) !== null) {
        if (col >= m.index && col < m.index + m[0].length) {
          e.preventDefault()
          window.electronAPI.shell.openPath(m[0].replace(/:\d+(?::\d+)?$/, '')).catch(() => {})
          return
        }
      }
      quotedPathRegex.lastIndex = 0
      while ((m = quotedPathRegex.exec(text)) !== null) {
        const inner = m[1] ?? m[2]
        const innerStart = m.index + 1
        if (col >= innerStart && col < innerStart + inner.length) {
          e.preventDefault()
          window.electronAPI.shell.openPath(inner.replace(/:\d+(?::\d+)?$/, '')).catch(() => {})
          return
        }
      }
    }

    this.element.addEventListener('mousemove', onMouseMove)
    this.element.addEventListener('mouseleave', onMouseLeave)
    this.element.addEventListener('mousedown', onMouseDown)
    this.cmdClickCleanup = () => {
      this.element.removeEventListener('mousemove', onMouseMove)
      this.element.removeEventListener('mouseleave', onMouseLeave)
      this.element.removeEventListener('mousedown', onMouseDown)
      document.removeEventListener('keydown', onKeyDown)
      document.removeEventListener('keyup', onKeyUp)
    }
  }

  private clearLinkHover(): void {
    if (this.linkOverlay) this.linkOverlay.style.display = 'none'
    this.terminal.element?.classList.remove('xterm-cursor-pointer')
  }

  // Call once after the element is in a visible, sized container.
  mount(container: HTMLElement): void {
    container.appendChild(this.element)
    if (!this.opened) {
      this.terminal.open(this.element)
      this.opened = true
    }
    this.fitAddon.fit()
    if (this.scrollToBottomOnMount) this.terminal.scrollToBottom()
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
    const charW = measureCharWidth(fontSize)
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
    const charW = measureCharWidth(fontSize)

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
    const reusableCell: IBufferCell | null =
      this.terminal.buffer.active.getLine(0)?.getCell(0) ?? null

    for (let row = 0; row < rows; row++) {
      const line = buffer.getLine(row)
      if (!line) continue
      const y = padY + (row + 1) * lineHeight - 2

      for (let col = 0; col < cols; col++) {
        const cell = line.getCell(col, reusableCell ?? undefined)
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
    this.cmdClickCleanup?.()
    this.cmdClickCleanup = null
    this.linkOverlay = null
    useSessionStore.getState().setSessionIdle(this.sessionId)
    this.unmount()
    this.outputUnsubscribe?.()
    this.outputUnsubscribe = null
    this.terminal.dispose()
  }
}
