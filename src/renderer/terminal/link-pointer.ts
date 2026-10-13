import type { Terminal } from '@xterm/xterm'
import { linkAt, type LinkTarget, type TerminalLink } from './terminal-links'

/** A cell on screen: its column, and its row counted from the top of the viewport. */
interface ScreenCell {
  col: number
  row: number
}

/** The cells xterm draws: where its screen starts and each cell's size, in CSS px. */
interface CellGrid {
  left: number
  top: number
  cellWidth: number
  cellHeight: number
}

function openTarget(target: LinkTarget): void {
  if ('url' in target) window.electronAPI.shell.openExternal(target.url).catch(() => {})
  else window.electronAPI.shell.openPath(target.path).catch(() => {})
}

/** Underlines the link under the pointer while ⌘ (Ctrl off macOS) is held, and opens it on
 * ⌘-click. On macOS Ctrl-click is a secondary click, left alone. */
export class LinkPointer {
  /** A 1px line under the hovered link, inside the terminal's element. */
  readonly overlay: HTMLDivElement
  private readonly isMac = navigator.platform.startsWith('Mac')
  // Where the pointer last was, to underline when ⌘ is pressed without moving.
  private lastCell: ScreenCell | null = null

  constructor(
    private readonly terminal: Terminal,
    private readonly element: HTMLElement
  ) {
    this.overlay = document.createElement('div')
    this.overlay.style.cssText =
      'position:absolute;pointer-events:none;height:1px;background:#4a9eff;display:none;z-index:10;'
    element.appendChild(this.overlay)
    element.addEventListener('mousemove', this.onMouseMove)
    element.addEventListener('mouseleave', this.onMouseLeave)
    element.addEventListener('mousedown', this.onMouseDown)
    document.addEventListener('keydown', this.onKeyDown)
    document.addEventListener('keyup', this.onKeyUp)
  }

  dispose(): void {
    this.element.removeEventListener('mousemove', this.onMouseMove)
    this.element.removeEventListener('mouseleave', this.onMouseLeave)
    this.element.removeEventListener('mousedown', this.onMouseDown)
    document.removeEventListener('keydown', this.onKeyDown)
    document.removeEventListener('keyup', this.onKeyUp)
  }

  private clear(): void {
    this.overlay.style.display = 'none'
    this.terminal.element?.classList.remove('xterm-cursor-pointer')
  }

  private isModifierHeld(e: MouseEvent): boolean {
    return this.isMac ? e.metaKey : e.ctrlKey
  }

  private isModifierKey(e: KeyboardEvent): boolean {
    return e.key === (this.isMac ? 'Meta' : 'Control')
  }

  // Both of xterm's renderers size `.xterm-screen` to exactly cols × rows cells,
  // inside the padding the pane gives `.xterm`. The WebGL renderer leaves no
  // `.xterm-rows` to measure, so the cells are read from the screen's box.
  private grid(): CellGrid | null {
    const screen = this.terminal.element?.querySelector('.xterm-screen')
    if (!screen) return null
    const box = screen.getBoundingClientRect()
    return {
      left: box.left,
      top: box.top,
      cellWidth: box.width / this.terminal.cols,
      cellHeight: box.height / this.terminal.rows,
    }
  }

  private cellAt(e: MouseEvent, grid: CellGrid): ScreenCell {
    return {
      col: Math.floor((e.clientX - grid.left) / grid.cellWidth),
      row: Math.floor((e.clientY - grid.top) / grid.cellHeight),
    }
  }

  private linkIn(cell: ScreenCell): TerminalLink | null {
    const buffer = this.terminal.buffer.active
    const line = buffer.getLine(buffer.viewportY + cell.row)
    return line ? linkAt(line.translateToString(true), cell.col) : null
  }

  private underline(cell: ScreenCell, grid: CellGrid): void {
    const link = this.linkIn(cell)
    if (!link) return this.clear()
    const origin = this.element.getBoundingClientRect()
    this.overlay.style.left = `${grid.left - origin.left + link.index * grid.cellWidth}px`
    this.overlay.style.top = `${grid.top - origin.top + (cell.row + 1) * grid.cellHeight - 1}px`
    this.overlay.style.width = `${link.length * grid.cellWidth}px`
    this.overlay.style.display = 'block'
    this.terminal.element?.classList.add('xterm-cursor-pointer')
  }

  private readonly onMouseMove = (e: MouseEvent): void => {
    const grid = this.grid()
    this.lastCell = grid && this.cellAt(e, grid)
    if (grid && this.lastCell && this.isModifierHeld(e)) this.underline(this.lastCell, grid)
    else this.clear()
  }

  private readonly onMouseLeave = (): void => {
    this.lastCell = null
    this.clear()
  }

  private readonly onKeyDown = (e: KeyboardEvent): void => {
    const grid = this.grid()
    if (grid && this.lastCell && this.isModifierKey(e)) this.underline(this.lastCell, grid)
  }

  private readonly onKeyUp = (e: KeyboardEvent): void => {
    if (this.isModifierKey(e)) this.clear()
  }

  private readonly onMouseDown = (e: MouseEvent): void => {
    const grid = this.grid()
    if (!grid || !this.isModifierHeld(e)) return
    const link = this.linkIn(this.cellAt(e, grid))
    if (!link) return
    e.preventDefault()
    openTarget(link.target)
  }
}
