import { describe, it, expect } from 'vitest'
import * as fs from 'node:fs'
import * as path from 'node:path'
import { GLYPHS, drawText, drawDigit, textWidth } from '../../../src/factory/art/glyphs.js'
import { signText } from '../../../src/factory/layout.js'
import type { RunNode } from '../../../src/line/run-graph.js'
import { parseRecipe } from '../../../src/recipe/parse.js'
import { createRecordingPaint } from './paint-fake.js'

const RECIPES = path.join(__dirname, '..', '..', '..', 'recipes')

function node(over: Partial<RunNode> = {}): RunNode {
  return {
    id: 'fix',
    stepId: 'fix',
    kind: 'agent',
    state: 'waiting',
    unitIds: [],
    lane: null,
    role: null,
    dependsOn: [],
    attempts: 0,
    reworks: 0,
    feedback: [],
    sessionId: null,
    worktreePath: null,
    startedAt: null,
    endedAt: null,
    ...over,
  }
}

describe('factory/art/glyphs', () => {
  it('has a 15-bit glyph for every letter, digit, hyphen, full stop and space', () => {
    const expected = [...'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-. ']
    expect(Object.keys(GLYPHS).sort()).toEqual([...expected].sort())
    for (const [ch, bits] of Object.entries(GLYPHS)) {
      expect(bits, ch).toMatch(/^[01]{15}$/)
    }
  })

  it('gives every visible glyph at least one lit cell and the space none', () => {
    for (const [ch, bits] of Object.entries(GLYPHS)) {
      expect(bits.includes('1'), ch).toBe(ch !== ' ')
    }
  })

  it('measures text as four pixels a character less the gap after the last', () => {
    expect(textWidth('A')).toBe(3)
    expect(textWidth('AB')).toBe(7)
    expect(textWidth('BUILDER U-1')).toBe(43)
  })

  it('draws lit cells 1px square at a 4px advance, in the colour it was given', () => {
    const paint = createRecordingPaint()
    drawText(paint, 10, 20, 'A-', '#123456')
    const rects = paint.calls.filter((c) => c.op === 'fillRect')
    // A = 010 101 111 101 101 (10 cells); '-' = the middle row (3 cells).
    expect(rects).toHaveLength(13)
    expect(rects.every((c) => c.op === 'fillRect' && c.w === 1 && c.h === 1)).toBe(true)
    expect(rects.every((c) => c.op === 'fillRect' && c.style === '#123456')).toBe(true)
    expect(rects[0]).toMatchObject({ x: 11, y: 20 })
    expect(rects.slice(10)).toMatchObject([
      { x: 14, y: 22 },
      { x: 15, y: 22 },
      { x: 16, y: 22 },
    ])
  })

  it('draws a character the font lacks as a space', () => {
    const paint = createRecordingPaint()
    drawText(paint, 0, 0, 'é', '#fff')
    expect(paint.calls).toHaveLength(0)
  })

  it('draws a digit at 2px scale from the same table', () => {
    const paint = createRecordingPaint()
    drawDigit(paint, 0, 0, '7', '#abc')
    // 7 = 111 001 010 010 010: seven lit cells, each 2x2.
    expect(paint.calls).toHaveLength(7)
    expect(paint.calls[0]).toMatchObject({ x: 0, y: 0, w: 2, h: 2, style: '#abc' })
    expect(paint.calls[2]).toMatchObject({ x: 4, y: 0 })
    expect(paint.calls[3]).toMatchObject({ x: 4, y: 2 })
  })

  it('draws nothing for something that is not a digit', () => {
    for (const bad of ['A', '', '12', '-']) {
      const paint = createRecordingPaint()
      drawDigit(paint, 0, 0, bad, '#abc')
      expect(paint.calls, bad).toHaveLength(0)
    }
  })

  it('has a glyph for every character a shipped recipe role or step id folds to', () => {
    const files = fs.readdirSync(RECIPES).filter((f) => f.endsWith('.yaml'))
    expect(files.length).toBeGreaterThan(0)
    let names = 0
    for (const file of files) {
      const parsed = parseRecipe(fs.readFileSync(path.join(RECIPES, file), 'utf-8'), file)
      if (!parsed.ok) throw new Error(parsed.reason)
      for (const step of parsed.value.steps) {
        const role = (step as unknown as { step?: { role?: string } }).step?.role
        for (const name of [step.id, role]) {
          if (name === undefined) continue
          names++
          const shown = signText(node({ id: step.id, stepId: name, role: null }), 99)
          for (const ch of shown) expect(GLYPHS[ch], `${file}: ${name} -> ${shown}`).toBeDefined()
        }
      }
    }
    expect(names).toBeGreaterThan(files.length)
  })
})

describe('factory/layout signText', () => {
  it('shows the role and its one unit when they fit', () => {
    expect(signText(node({ role: 'builder', unitIds: ['U-1'] }), 12)).toBe('BUILDER U-1')
  })

  it.each([
    ['desk', 12],
    ['rig', 8],
    ['gate', 4],
  ] as const)('the %s width (%i characters) picks the longest candidate that fits', (_k, width) => {
    const n = node({ role: 'builder', unitIds: ['U-1'] })
    const shown = signText(n, width)
    expect(shown.length).toBeLessThanOrEqual(width)
    expect(['BUILDER U-1', 'U-1', 'BUILDER', 'BUILDE.', 'BUI.']).toContain(shown)
  })

  it('falls back from "who unit" to the unit to the role', () => {
    const n = node({ role: 'builder', unitIds: ['U-1'] })
    expect(signText(n, 11)).toBe('BUILDER U-1')
    expect(signText(n, 10)).toBe('U-1')
    expect(signText(node({ role: 'builder', unitIds: ['LONGUNIT-1'] }), 8)).toBe('BUILDER')
  })

  it('shows the role alone for a node with no unit or with several', () => {
    expect(signText(node({ role: 'builder' }), 12)).toBe('BUILDER')
    expect(signText(node({ role: 'builder', unitIds: ['U-1', 'U-2'] }), 12)).toBe('BUILDER')
  })

  it('cuts a name that fits nowhere and ends it with a full stop', () => {
    expect(signText(node({ role: 'documentation' }), 8)).toBe('DOCUMEN.')
    expect(signText(node({ role: 'documentation' }), 4)).toBe('DOC.')
    expect(signText(node({ role: 'documentation', unitIds: ['U-1'] }), 8)).toBe('U-1')
  })

  it('names a step by its step id when it has no role', () => {
    expect(signText(node({ id: 'lint', stepId: 'lint' }), 8)).toBe('LINT')
  })

  it('falls back to the node id when the role and step id are blank', () => {
    expect(signText(node({ id: 'fix:U-1', stepId: ' ', role: '' }), 8)).toBe('FIX-U-1')
    expect(signText(node({ id: 'ship', stepId: '', role: null }), 8)).toBe('SHIP')
  })

  it('upper-cases and folds every character the font lacks to a hyphen', () => {
    expect(signText(node({ role: 'code_review' }), 12)).toBe('CODE-REVIEW')
    expect(signText(node({ role: 'a/b.c' }), 12)).toBe('A-B-C')
    expect(signText(node({ role: 'é' }), 12)).toBe('-')
    expect(signText(node({ role: 'qa', unitIds: ['fix:auth/1'] }), 13)).toBe('QA FIX-AUTH-1')
  })
})
