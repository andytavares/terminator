import type { Paint } from './kit.js'
import { rect } from './kit.js'

// The hall's one pixel font: 3 wide by 5 tall, row-major, one bit per cell.
// Station names are stencilled with it at 1px; the status wall, the queue
// plate and the lane numbers scale its digits to 2px.

const GLYPH_W = 3
const GLYPH_H = 5

export const GLYPHS: Readonly<Record<string, string>> = {
  A: '010101111101101',
  B: '110101110101110',
  C: '011100100100011',
  D: '110101101101110',
  E: '111100110100111',
  F: '111100110100100',
  G: '011100101101011',
  H: '101101111101101',
  I: '111010010010111',
  J: '001001001101010',
  K: '101101110101101',
  L: '100100100100111',
  M: '101111111101101',
  N: '110101101101101',
  O: '010101101101010',
  P: '110101110100100',
  Q: '010101101110011',
  R: '110101110101101',
  S: '011100010001110',
  T: '111010010010010',
  U: '101101101101111',
  V: '101101101101010',
  W: '101101111111101',
  X: '101101010101101',
  Y: '101101010010010',
  Z: '111001010100111',
  '0': '111101101101111',
  '1': '010110010010111',
  '2': '111001111100111',
  '3': '111001111001111',
  '4': '101101111001001',
  '5': '111100111001111',
  '6': '111100111101111',
  '7': '111001010010010',
  '8': '111101111101111',
  '9': '111101111001111',
  '-': '000000111000000',
  '.': '000000000000010',
  ' ': '000000000000000',
}

/** Pixels a run of `text` occupies at 1px: three per glyph, one between. */
export function textWidth(text: string): number {
  return text.length * 4 - 1
}

/** Draw `text` at 1px with its top-left at (x, y); a character the font lacks is a space. */
export function drawText(paint: Paint, x: number, y: number, text: string, color: string): void {
  let cx = x
  for (const ch of text) {
    const bits = GLYPHS[ch] ?? GLYPHS[' ']
    for (let j = 0; j < GLYPH_H; j++) {
      for (let i = 0; i < GLYPH_W; i++) {
        if (bits[j * GLYPH_W + i] === '1') rect(paint, cx + i, y + j, 1, 1, color)
      }
    }
    cx += 4
  }
}

/** One digit at 2px — the status wall, the queue plate and the lane stencil. */
export function drawDigit(paint: Paint, x: number, y: number, digit: string, color: string): void {
  const bits = digit.length === 1 && digit >= '0' && digit <= '9' ? GLYPHS[digit] : undefined
  if (bits === undefined) return
  for (let j = 0; j < GLYPH_H; j++) {
    for (let i = 0; i < GLYPH_W; i++) {
      if (bits[j * GLYPH_W + i] === '1') rect(paint, x + i * 2, y + j * 2, 2, 2, color)
    }
  }
}
