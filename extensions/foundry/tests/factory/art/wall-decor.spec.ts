import * as fs from 'node:fs'
import * as path from 'node:path'
import { describe, it, expect } from 'vitest'

import { vendingDecorX, wallDecorX, whiteboardX } from '../../../src/factory/art/props.js'
import { layoutHall, TILE_PX } from '../../../src/factory/layout.js'
import type { HallMap, HallProp } from '../../../src/factory/layout.js'
import type { RunGraph } from '../../../src/line/run-graph.js'
import { partialFake } from '../../../../../tests/support/fakes'

const FIXTURES = path.join(__dirname, '..', 'fixtures')
const WALL_KINDS = ['shelves', 'racks', 'statuswall', 'lockers']
const WHITEBOARD_W = 48
const VENDING_W = 14

const graphs = fs
  .readdirSync(FIXTURES)
  .filter((file) => file.startsWith('run-graph') && file.endsWith('.json'))
  .map(
    (file) =>
      [file, JSON.parse(fs.readFileSync(path.join(FIXTURES, file), 'utf-8')) as RunGraph] as const
  )

function fixtureSpans(map: HallMap): [number, number][] {
  return map.props
    .filter((prop) => WALL_KINDS.includes(prop.kind))
    .map((prop) => [prop.x * TILE_PX, (prop.x + prop.w) * TILE_PX])
}

const overlaps = (a: readonly [number, number], b: readonly [number, number]): boolean =>
  a[0] < b[1] && b[0] < a[1]

describe('the whiteboard and the vending machine on the wall', () => {
  it('hangs the narrow real hall (27 tiles) at 86 px, clear of its shelves and racks', () => {
    const narrow = graphs.find(([file]) => file.includes('narrow'))![1]
    const map = layoutHall(narrow)
    expect(map.width).toBe(27)
    expect(whiteboardX(map)).toBe(86)
  })

  it.each(graphs)('%s: neither item meets a fixture or the other', (_file, graph) => {
    const map = layoutHall(graph)
    const board = whiteboardX(map)
    const vending = vendingDecorX(map)
    expect(board).not.toBeNull()
    const boardSpan: [number, number] = [board as number, (board as number) + WHITEBOARD_W]
    for (const span of fixtureSpans(map)) expect(overlaps(boardSpan, span)).toBe(false)
    if (vending === null) return
    const vendingSpan: [number, number] = [vending, vending + VENDING_W]
    for (const span of fixtureSpans(map)) expect(overlaps(vendingSpan, span)).toBe(false)
    expect(overlaps(vendingSpan, boardSpan)).toBe(false)
  })

  it('scans every x when no preferred spot is clear, and gives null when none is', () => {
    const wall = (x: number, w: number): HallProp =>
      partialFake<HallProp>({ kind: 'shelves', x, w })
    const open = partialFake<HallMap>({ width: 20, props: [wall(3, 2)] })
    expect(wallDecorX(open, { width: 48, preferred: [3 / 20], taken: [] })).not.toBeNull()
    const full = partialFake<HallMap>({ width: 20, props: [wall(1, 18)] })
    expect(wallDecorX(full, { width: 48, preferred: [0.5], taken: [] })).toBeNull()
  })
})
