// The minimal surface every draw function in this scene renders through.
//
// Tests never touch a real canvas — jsdom has none — so every draw function
// takes this interface and a spec can pass a recording fake instead. The
// shape is exactly the handful of CanvasRenderingContext2D members the art
// actually uses, never the whole API.

export interface PaintGradient {
  addColorStop(offset: number, color: string): void
}

export interface Paint {
  fillStyle: string | PaintGradient
  globalCompositeOperation: string
  fillRect(x: number, y: number, w: number, h: number): void
  createRadialGradient(
    x0: number,
    y0: number,
    r0: number,
    x1: number,
    y1: number,
    r1: number
  ): PaintGradient
  drawImage(image: CanvasImageSource, dx: number, dy: number): void
}

/** A tiny deterministic PRNG — the same seed always draws the same wear. */
export function mulberry32(seed: number): () => number {
  let state = seed | 0
  return () => {
    state = (state + 0x6d2b79f5) | 0
    let t = Math.imul(state ^ (state >>> 15), 1 | state)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** A flat-filled rectangle, rounded to whole device pixels. */
export function rect(
  paint: Paint,
  x: number,
  y: number,
  w: number,
  h: number,
  color: string
): void {
  paint.fillStyle = color
  paint.fillRect(Math.round(x), Math.round(y), w, h)
}

/** A one-pixel top/left highlight and bottom/right shadow — the plate's bevel. */
export function bevel(
  paint: Paint,
  x: number,
  y: number,
  w: number,
  h: number,
  hi: string,
  lo: string
): void {
  rect(paint, x, y, w, 1, hi)
  rect(paint, x, y, 1, h, hi)
  rect(paint, x, y + h - 1, w, 1, lo)
  rect(paint, x + w - 1, y, 1, h, lo)
}

/** Four corner rivets, inset by 2px, the plated-floor detail the mock used. */
export function rivets(
  paint: Paint,
  x: number,
  y: number,
  w: number,
  h: number,
  color: string
): void {
  rect(paint, x + 2, y + 2, 1, 1, color)
  rect(paint, x + w - 3, y + 2, 1, 1, color)
  rect(paint, x + 2, y + h - 3, 1, 1, color)
  rect(paint, x + w - 3, y + h - 3, 1, 1, color)
}

/** Scattered smudges over a tile, seeded so the same tile always wears the same way. */
export function wear(
  paint: Paint,
  x: number,
  y: number,
  w: number,
  h: number,
  seed: number,
  color: string,
  count = 5
): void {
  const rnd = mulberry32(seed)
  for (let i = 0; i < count; i++) {
    if (rnd() >= 0.55) continue
    const sx = x + 2 + Math.floor(rnd() * (w - 4))
    const sy = y + 2 + Math.floor(rnd() * (h - 4))
    const sw = 1 + Math.floor(rnd() * 2)
    rect(paint, sx, sy, sw, 1, color)
  }
}

/** Faint fixed horizontal scanlines over the whole frame. */
export function scanlines(
  paint: Paint,
  width: number,
  height: number,
  color = 'rgba(0,0,0,.08)'
): void {
  paint.fillStyle = color
  for (let y = 0; y < height; y += 2) paint.fillRect(0, y, width, 1)
}

/**
 * An additive glow: caller is responsible for `globalCompositeOperation`
 * (`'lighter'` for a light source, `'destination-out'` to cut a hole in a
 * darkness layer) — this only paints the gradient.
 */
export function glow(
  paint: Paint,
  cx: number,
  cy: number,
  r: number,
  rgba0: string,
  rgba1: string
): void {
  const gradient = paint.createRadialGradient(cx, cy, 0, cx, cy, r)
  gradient.addColorStop(0, rgba0)
  gradient.addColorStop(1, rgba1)
  paint.fillStyle = gradient
  paint.fillRect(cx - r, cy - r, r * 2, r * 2)
}
