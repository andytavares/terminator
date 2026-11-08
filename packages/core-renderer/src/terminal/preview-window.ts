export interface PreviewGeometry {
  rows: number
  /** The cursor's row on screen, 0 at the top. */
  cursorY: number
  lineHeight: number
  naturalW: number
  naturalH: number
  containerW: number
  containerH: number
}

/** Padding the terminal element draws above its first row, in natural pixels. */
const TOP_INSET = 4

/**
 * How a terminal screen sits in a preview box.
 *
 * Scaled to the box's width, because shrinking a wide terminal until its whole
 * height fits leaves text too small to read. When the screen is then taller
 * than the box, the window follows the cursor, so the line being written is the
 * last one shown — where an agent's question or a build's result appears.
 */
export function previewWindow(g: PreviewGeometry): { scale: number; translateY: number } {
  const scale = g.containerW / g.naturalW
  if (g.naturalH * scale <= g.containerH) return { scale, translateY: 0 }
  const visibleRows = Math.max(1, Math.floor((g.containerH / scale - TOP_INSET) / g.lineHeight))
  const top = Math.min(Math.max(0, g.cursorY + 1 - visibleRows), Math.max(0, g.rows - visibleRows))
  return { scale, translateY: top === 0 ? 0 : -top * g.lineHeight * scale }
}
