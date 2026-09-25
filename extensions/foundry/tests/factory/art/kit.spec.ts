import { describe, it, expect } from 'vitest'
import {
  mulberry32,
  rect,
  bevel,
  rivets,
  wear,
  scanlines,
  glow,
} from '../../../src/factory/art/kit.js'
import { createRecordingPaint } from './paint-fake.js'

describe('factory/art/kit', () => {
  it('mulberry32 is deterministic for a seed', () => {
    const a = mulberry32(7)
    const b = mulberry32(7)
    const seqA = [a(), a(), a()]
    const seqB = [b(), b(), b()]
    expect(seqA).toEqual(seqB)
  })

  it('mulberry32 differs across seeds', () => {
    const a = mulberry32(1)()
    const b = mulberry32(2)()
    expect(a).not.toBe(b)
  })

  it('rect fills one rounded rectangle in the given colour', () => {
    const paint = createRecordingPaint()
    rect(paint, 1.6, 2.2, 4, 5, '#abc')
    expect(paint.calls).toEqual([{ op: 'fillRect', x: 2, y: 2, w: 4, h: 5, style: '#abc' }])
  })

  it('bevel draws a highlight on top/left and a shadow on bottom/right', () => {
    const paint = createRecordingPaint()
    bevel(paint, 0, 0, 10, 10, '#fff', '#000')
    const styles = paint.calls.map((c) => (c.op === 'fillRect' ? c.style : null))
    expect(styles).toEqual(['#fff', '#fff', '#000', '#000'])
    expect(paint.calls).toHaveLength(4)
  })

  it('rivets marks all four corners inset by two pixels', () => {
    const paint = createRecordingPaint()
    rivets(paint, 0, 0, 16, 16, '#555')
    expect(paint.calls).toEqual([
      { op: 'fillRect', x: 2, y: 2, w: 1, h: 1, style: '#555' },
      { op: 'fillRect', x: 13, y: 2, w: 1, h: 1, style: '#555' },
      { op: 'fillRect', x: 2, y: 13, w: 1, h: 1, style: '#555' },
      { op: 'fillRect', x: 13, y: 13, w: 1, h: 1, style: '#555' },
    ])
  })

  it('wear draws the same smudges for the same seed', () => {
    const a = createRecordingPaint()
    const b = createRecordingPaint()
    wear(a, 0, 0, 16, 16, 42, '#111')
    wear(b, 0, 0, 16, 16, 42, '#111')
    expect(a.calls).toEqual(b.calls)
  })

  it('wear draws different smudges for a different seed', () => {
    const a = createRecordingPaint()
    const b = createRecordingPaint()
    wear(a, 0, 0, 16, 16, 1, '#111')
    wear(b, 0, 0, 16, 16, 2, '#111')
    expect(a.calls).not.toEqual(b.calls)
  })

  it('wear draws nothing impossible for a zero-size tile', () => {
    const paint = createRecordingPaint()
    expect(() => wear(paint, 0, 0, 0, 0, 1, '#111')).not.toThrow()
  })

  it('scanlines draws one faint row every two pixels down the whole frame', () => {
    const paint = createRecordingPaint()
    scanlines(paint, 32, 8)
    const rows = paint.calls.filter((c) => c.op === 'fillRect')
    expect(rows).toHaveLength(4)
    expect(rows[0]).toMatchObject({ x: 0, y: 0, w: 32, h: 1 })
    expect(rows[3]).toMatchObject({ x: 0, y: 6, w: 32, h: 1 })
  })

  it('glow paints a radial gradient from full colour to transparent', () => {
    const paint = createRecordingPaint()
    glow(paint, 10, 10, 5, 'rgba(1,2,3,.5)', 'rgba(1,2,3,0)')
    const fill = paint.calls.find((c) => c.op === 'fillRect')
    expect(fill).toMatchObject({ x: 5, y: 5, w: 10, h: 10 })
  })
})
