import { describe, it, expect } from 'vitest'
import * as fs from 'node:fs'
import * as path from 'node:path'
import { layoutHall, stationKind, TILE_PX } from '../../src/factory/layout.js'
import type { HallMap, HallProp, Tile } from '../../src/factory/layout.js'
import { findPath, distancesFrom } from '../../src/factory/path.js'
import { buildRunGraph } from '../../src/line/run-graph.js'
import type { RunGraph, RunNode } from '../../src/line/run-graph.js'
import { parseRecipe } from '../../src/recipe/parse.js'
import type { Recipe } from '../../src/recipe/parse.js'
import { draftOrder } from '../../src/order/schema.js'
import type { WorkOrder } from '../../src/order/schema.js'

// Two real recipes drive most of these tests, the same way
// tests/line/run-graph.spec.ts exercises buildRunGraph — this is a layout of
// an actual run graph, not of a hand-built fixture that only happens to look
// like one. The golden fixtures pin the prototype's exact output; the
// property tests sweep every recipe the repo ships, at every lane count.

function recipeFrom(file: string): Recipe {
  const text = fs.readFileSync(path.join(__dirname, '..', '..', 'recipes', file), 'utf-8')
  const parsed = parseRecipe(text, file)
  if (!parsed.ok) throw new Error(parsed.reason)
  return parsed.value
}

function unit(
  id: string,
  lane: number,
  dependsOn: string[] = [],
  role = 'builder'
): WorkOrder['plan']['units'][number] {
  return { id, title: id, role, lane, dependsOn, satisfies: ['AC-1'], touches: [], verify: [] }
}

function orderFor(recipeId: string, lanes: number[]): WorkOrder {
  const base = draftOrder({
    id: 'WO-1',
    title: 'x',
    source: { kind: 'typed', tracker: null, key: null, url: null },
    repoPaths: lanes.map((n) => `/repos/${recipeId}-${n}`),
    now: '2026-09-06T10:00:00.000Z',
  })
  return {
    ...base,
    recipe: recipeId,
    risk: { ...base.risk, triggers: ['db_migration'] },
    plan: {
      ...base.plan,
      units: lanes.map((lane) => unit(`U-${lane}`, lane)),
      lanes: lanes.map((ord) => ({
        ord,
        repo: `repo-${ord}`,
        branch: '',
        role: null,
        blocks: [],
        blockedBy: [],
      })),
    },
  }
}

function graphFor(recipeFile: string, lanes: number[]): RunGraph {
  const recipe = recipeFrom(recipeFile)
  const order = orderFor(recipe.id, lanes)
  return buildRunGraph(order, recipe)
}

function stationsOf(props: readonly HallProp[]): HallProp[] {
  return props.filter((p) => p.nodeId !== null)
}

function rn(over: Partial<RunNode> & Pick<RunNode, 'id' | 'kind'>): RunNode {
  return {
    stepId: over.id,
    state: 'waiting',
    unitIds: [],
    lane: null,
    role: null,
    dependsOn: [],
    attempts: 0,
    sessionId: null,
    worktreePath: null,
    startedAt: null,
    endedAt: null,
    ...over,
  }
}

function graph(nodes: RunNode[]): RunGraph {
  return { orderId: 'WO-hand', recipe: 'hand', nodes }
}

const CREWED_KINDS = ['agent', 'fanout', 'run', 'judge']
function isCrewed(node: RunNode): boolean {
  return node.role !== null || CREWED_KINDS.includes(node.kind)
}

/**
 * The tiles the routed search itself refuses to enter: every station seat
 * and every anchor. Only the last-resort BFS-over-`solid` fallback can put a
 * belt on one of these, since the routed search's own `passBelt` predicate
 * excludes them structurally — so a belt path touching one is the honest
 * sign that a route fell back rather than being found.
 */
function blockedForBeltKeys(map: HallMap): Set<string> {
  const blocked = new Set<string>()
  for (const p of map.props) if (p.seat !== null) blocked.add(`${p.seat.x},${p.seat.y}`)
  for (const anchor of [map.anchors.archive, map.anchors.rack, map.anchors.wait]) {
    blocked.add(`${anchor.x},${anchor.y}`)
  }
  return blocked
}

describe('layoutHall — golden output', () => {
  const GOLDEN: Record<string, { file: string; lanes: number[] }> = {
    'standard-3': { file: 'standard.yaml', lanes: [1, 2, 3] },
    'bugfix-1': { file: 'bugfix.yaml', lanes: [1] },
    'standard-2': { file: 'standard.yaml', lanes: [1, 2] },
  }

  const goldenPath = path.join(__dirname, 'fixtures', 'hall-golden.json')
  const golden: Record<string, unknown> = JSON.parse(fs.readFileSync(goldenPath, 'utf-8'))

  for (const [key, { file, lanes }] of Object.entries(GOLDEN)) {
    it(`matches the prototype's output for ${key}`, () => {
      const map = layoutHall(graphFor(file, lanes))
      const expected = golden[key] as {
        width: number
        height: number
        props: unknown
        belts: unknown
        beltTiles: unknown
        crossovers: unknown
        restSeats: unknown
        breakroom: unknown
        lights: unknown
        anchors: unknown
        walk: string[]
      }
      expect(map.width).toBe(expected.width)
      expect(map.height).toBe(expected.height)
      expect(
        map.props.map((p) => ({
          id: p.id,
          kind: p.kind,
          x: p.x,
          y: p.y,
          w: p.w,
          h: p.h,
          nodeId: p.nodeId,
          seat: p.seat,
        }))
      ).toEqual(expected.props)
      expect(
        map.belts.map((b) => ({
          id: b.id,
          fromNodeId: b.fromNodeId,
          toNodeId: b.toNodeId,
          path: b.path,
        }))
      ).toEqual(expected.belts)
      expect(map.beltTiles).toEqual(expected.beltTiles)
      expect(map.crossovers).toEqual(expected.crossovers)
      expect(map.restSeats.map((s) => ({ id: s.id, tile: s.tile, facing: s.facing }))).toEqual(
        expected.restSeats
      )
      expect(map.breakroom).toEqual(expected.breakroom)
      expect(map.lights).toEqual(expected.lights)
      expect(map.anchors).toEqual(expected.anchors)
      const walkRows = map.walk.map((row) => row.map((v) => (v ? '#' : '.')).join(''))
      expect(walkRows).toEqual(expected.walk)
    })
  }
})

describe('layoutHall — properties, across every recipe and lane count', () => {
  const recipeFiles = fs
    .readdirSync(path.join(__dirname, '..', '..', 'recipes'))
    .filter((f) => f.endsWith('.yaml'))
  const laneSets: number[][] = [[1], [1, 2], [1, 2, 3], [1, 2, 3, 4, 5]]

  for (const file of recipeFiles) {
    for (const lanes of laneSets) {
      describe(`${file} lanes=[${lanes.join(',')}]`, () => {
        const g = graphFor(file, lanes)
        const map = layoutHall(g)

        it('has a non-empty graph to test against', () => {
          expect(g.nodes.length).toBeGreaterThan(0)
        })

        it('seats every rest seat on a bench or sofa prop, at the seat tile itself', () => {
          expect(map.restSeats.length).toBeGreaterThan(0)
          for (const seat of map.restSeats) {
            const prop = map.props.find((p) => p.id === seat.propId) as HallProp | undefined
            expect(prop).toBeDefined()
            expect(['restbench', 'sofa']).toContain((prop as HallProp).kind)
            const p = prop as HallProp
            expect(seat.tile.x).toBeGreaterThanOrEqual(p.x)
            expect(seat.tile.x).toBeLessThan(p.x + p.w)
            expect(seat.tile.y).toBe(p.y)
          }
        })

        it('gives at least two more rest seats than crewed nodes', () => {
          const crewedCount = g.nodes.filter(isCrewed).length
          expect(map.restSeats.length).toBeGreaterThanOrEqual(crewedCount + 2)
        })

        it('never lets a belt tile stand in for a walkable tile, except a crossover', () => {
          expect(map.beltTiles.length).toBeGreaterThan(0)
          const crossoverKeys = new Set(map.crossovers.map((t) => `${t.x},${t.y}`))
          for (const tile of map.beltTiles) {
            const k = `${tile.x},${tile.y}`
            if (crossoverKeys.has(k)) {
              expect(map.walk[tile.y][tile.x]).toBe(false)
            } else {
              expect(map.walk[tile.y][tile.x]).toBe(true)
            }
          }
        })

        it('reaches every station seat, rest seat, anchor and the exit from the intake', () => {
          const stationSeats = map.props.filter((p) => p.seat !== null).map((p) => p.seat as Tile)
          const targets: Tile[] = [
            ...stationSeats,
            map.anchors.exit,
            map.anchors.archive,
            map.anchors.rack,
            map.anchors.wait,
          ]
          expect(targets.length).toBeGreaterThan(0)
          for (const target of targets) {
            const p = findPath(map.walk, map.anchors.intake, target)
            expect(p.length).toBeGreaterThan(0)
            expect(p[p.length - 1]).toEqual(target)
          }
          // rest seats are reached via a neighbouring tile, since the seat
          // itself is only enterable as a goal once it is taken.
          const distances = distancesFrom(map.walk, map.anchors.intake)
          for (const seat of map.restSeats) {
            const neighbours = [
              { x: seat.tile.x + 1, y: seat.tile.y },
              { x: seat.tile.x - 1, y: seat.tile.y },
              { x: seat.tile.x, y: seat.tile.y + 1 },
              { x: seat.tile.x, y: seat.tile.y - 1 },
            ]
            const reached = neighbours.some((n) => distances.has(`${n.x},${n.y}`))
            expect(reached).toBe(true)
          }
        })

        it('routes every belt as a 4-contiguous path from port to port', () => {
          expect(map.belts.length).toBeGreaterThan(0)
          const byNode = new Map(
            map.props.filter((p) => p.nodeId).map((p) => [p.nodeId as string, p])
          )
          for (const belt of map.belts) {
            expect(belt.path.length).toBeGreaterThan(0)
            let prev = belt.path[0]
            for (const t of belt.path.slice(1)) {
              expect(Math.abs(t.x - prev.x) + Math.abs(t.y - prev.y)).toBe(1)
              prev = t
            }
            const from = byNode.get(belt.fromNodeId) as HallProp
            const to = byNode.get(belt.toNodeId) as HallProp
            expect(belt.path[0]).toEqual({ x: from.x + from.w, y: from.y })
            expect(belt.path[belt.path.length - 1]).toEqual({ x: to.x - 1, y: to.y })
          }
        })

        it('never gives a belt tile more than one input and more than one output at once', () => {
          expect(map.beltTiles.length).toBeGreaterThan(0)
          for (const tile of map.beltTiles) {
            expect(tile.ins.length > 1 && tile.outs.length > 1).toBe(false)
          }
        })

        it('never falls back to the BFS path', () => {
          expect(map.belts.length).toBeGreaterThan(0)
          const blocked = blockedForBeltKeys(map)
          for (const belt of map.belts) {
            for (const t of belt.path) {
              expect(blocked.has(`${t.x},${t.y}`)).toBe(false)
            }
          }
        })
      })
    }
  }

  it('gives the 3-lane standard graph at least one split and one merge', () => {
    const map = layoutHall(graphFor('standard.yaml', [1, 2, 3]))
    const kinds = map.beltTiles.map((t) => t.kind)
    expect(kinds).toContain('split')
    expect(kinds).toContain('merge')
  })
})

describe('layoutHall', () => {
  const FIXTURES: { file: string; lanes: number[] }[] = [
    { file: 'standard.yaml', lanes: [1, 2] },
    { file: 'bugfix.yaml', lanes: [1] },
  ]

  for (const { file, lanes } of FIXTURES) {
    describe(file, () => {
      const graph = graphFor(file, lanes)

      it('has a non-empty fixture to test against', () => {
        expect(graph.nodes.length).toBeGreaterThan(0)
      })

      it('gives every node exactly one station prop, of the right kind', () => {
        const map = layoutHall(graph)
        for (const node of graph.nodes) {
          const stations = map.props.filter((p) => p.nodeId === node.id)
          expect(stations).toHaveLength(1)
          expect(stations[0].kind).toBe(stationKind(node.kind))
        }
      })

      it('turns lanes into rows, ascending', () => {
        const map = layoutHall(graph)
        expect(map.lanes.length).toBeGreaterThan(0)
        const sorted = [...map.lanes].sort((a, b) => a.lane - b.lane)
        expect(map.lanes).toEqual(sorted)
        for (let i = 1; i < map.lanes.length; i++) {
          expect(map.lanes[i].row).toBeGreaterThan(map.lanes[i - 1].row)
        }
      })

      it('places deeper nodes further right', () => {
        const map = layoutHall(graph)
        const byId = new Map(graph.nodes.map((n) => [n.id, n]))
        // reproduce/scout is a root; everything it (transitively) precedes
        // must sit at an equal or greater column.
        const root = graph.nodes.find((n) => n.dependsOn.length === 0)
        expect(root).toBeDefined()
        const rootStation = stationsOf(map.props).find((p) => p.nodeId === root!.id)!
        for (const node of graph.nodes) {
          if (node.id === root!.id) continue
          if (!dependsTransitively(byId, node.id, root!.id)) continue
          const station = stationsOf(map.props).find((p) => p.nodeId === node.id)!
          expect(station.x).toBeGreaterThan(rootStation.x)
        }
      })

      it('gives archive, rack and wait a clear floor tile', () => {
        const map = layoutHall(graph)
        expect(map.solid[map.anchors.archive.y][map.anchors.archive.x]).toBe(false)
        expect(map.solid[map.anchors.rack.y][map.anchors.rack.x]).toBe(false)
        expect(map.solid[map.anchors.wait.y][map.anchors.wait.x]).toBe(false)
      })

      it('spreads the four wall fixtures across the width instead of one bay', () => {
        const map = layoutHall(graph)
        const fixtureKinds: HallProp['kind'][] = ['shelves', 'racks', 'statuswall', 'lockers']
        const fixtures = fixtureKinds.map(
          (kind) => map.props.find((p) => p.kind === kind) as HallProp
        )
        expect(fixtures.every((f) => f !== undefined)).toBe(true)
        const xs = fixtures.map((f) => f.x)
        expect(new Set(xs).size).toBe(xs.length)
        const spread = Math.max(...xs) - Math.min(...xs)
        expect(spread).toBeGreaterThan(map.width / 3)
      })

      it('is deterministic: the same graph lays out identically twice', () => {
        const a = layoutHall(graph)
        const b = layoutHall(graph)
        expect(a).toEqual(b)
      })

      it('still gives a skipped node its station', () => {
        const map = layoutHall(graph)
        const skipped = graph.nodes.filter((n) => n.state === 'skipped')
        for (const node of skipped) {
          expect(map.props.some((p) => p.nodeId === node.id)).toBe(true)
        }
      })
    })
  }

  it('exposes TILE_PX as a positive pixel size', () => {
    expect(TILE_PX).toBeGreaterThan(0)
  })

  describe('hand-built graphs, for the shapes no real recipe happens to produce', () => {
    it('gives a judge node a bench station', () => {
      const g = graph([rn({ id: 'inspect', kind: 'judge' })])
      const map = layoutHall(g)
      const station = map.props.find((p) => p.nodeId === 'inspect')!
      expect(station.kind).toBe('bench')
      expect(stationKind('judge')).toBe('bench')
    })

    it('lays out a graph with no edges at all: one belt-free node per station, all in the yard', () => {
      const g = graph([
        rn({ id: 'a', kind: 'agent' }),
        rn({ id: 'b', kind: 'run' }),
        rn({ id: 'c', kind: 'gate' }),
      ])
      const map = layoutHall(g)
      expect(map.belts).toEqual([])
      expect(map.lanes).toEqual([])
      const stations = g.nodes.map((node) => map.props.find((p) => p.nodeId === node.id)!)
      expect(stations).toHaveLength(3)
      // every node is a root, so they share depth 0 and stand side by side
      expect(new Set(stations.map((p) => p.y)).size).toBe(1)
      const byX = [...stations].sort((p, q) => p.x - q.x)
      expect(byX[0].x).toBe(3)
      for (let i = 1; i < byX.length; i++) {
        expect(byX[i].x).toBeGreaterThanOrEqual(byX[i - 1].x + byX[i - 1].w)
      }
    })

    it('never overlaps two stations that share a lane and a depth', () => {
      const g = graph([
        rn({ id: 'root', kind: 'agent' }),
        rn({ id: 'x', kind: 'agent', lane: 1, dependsOn: ['root'] }),
        rn({ id: 'y', kind: 'run', lane: 1, dependsOn: ['root'] }),
        rn({ id: 'z', kind: 'agent', lane: 2, dependsOn: ['root'] }),
      ])
      const map = layoutHall(g)
      const stations = stationsOf(map.props)
      expect(stations.length).toBe(4)
      for (const a of stations) {
        for (const b of stations) {
          if (a === b) continue
          const overlap = a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h
          expect(overlap).toBe(false)
        }
      }
      for (const p of stations) expect(map.solid[p.seat!.y][p.seat!.x]).toBe(false)
    })

    it('gives the yard a clear row under the wall and a press two rows of footprint', () => {
      const g = graph([
        rn({ id: 'a', kind: 'agent' }),
        rn({ id: 'j', kind: 'join', dependsOn: ['a'] }),
      ])
      const map = layoutHall(g)
      const press = map.props.find((p) => p.nodeId === 'j')!
      expect(press.kind).toBe('press')
      expect(press.h).toBe(2)
      expect(press.seat!.y).toBe(press.y + 2)
      for (const p of stationsOf(map.props)) {
        expect(map.solid[p.y - 1][p.x]).toBe(false)
      }
    })

    it('places every node with lane: null in the yard band, none in a lane row', () => {
      const g = graph([
        rn({ id: 'a', kind: 'agent' }),
        rn({ id: 'b', kind: 'agent', dependsOn: ['a'] }),
      ])
      const map = layoutHall(g)
      expect(map.lanes).toEqual([])
      const rows = new Set(stationsOf(map.props).map((p) => p.y))
      expect(rows.size).toBe(1)
    })

    it('lays out a single lane as one row below the yard', () => {
      const g = graph([
        rn({ id: 'scout', kind: 'agent' }),
        rn({ id: 'build:lane-1', kind: 'fanout', lane: 1, dependsOn: ['scout'] }),
      ])
      const map = layoutHall(g)
      expect(map.lanes).toHaveLength(1)
      expect(map.lanes[0]).toEqual({ lane: 1, row: map.lanes[0].row, label: 'Lane 1' })
      const laneStation = map.props.find((p) => p.nodeId === 'build:lane-1')!
      expect(laneStation.y).toBe(map.lanes[0].row)
    })

    it('spans a join across the two lane stations it depends on directly', () => {
      const g = graph([
        rn({ id: 'build:lane-1', kind: 'fanout', lane: 1 }),
        rn({ id: 'build:lane-2', kind: 'fanout', lane: 2 }),
        rn({
          id: 'integrate',
          kind: 'join',
          dependsOn: ['build:lane-1', 'build:lane-2'],
        }),
      ])
      const map = layoutHall(g)
      const joinStation = map.props.find((p) => p.nodeId === 'integrate')!
      expect(joinStation.kind).toBe('press')
      // Both lane belts must reach the join's own station (it has no lane of
      // its own, so it sits in the yard — reachability, not row identity, is
      // what "spans the lanes it joins" has to mean here).
      const belts = map.belts.filter((b) => b.toNodeId === 'integrate')
      expect(belts).toHaveLength(2)
      for (const belt of belts) expect(belt.path.length).toBeGreaterThan(0)
    })

    it('still gives every node a station when a dependency names an id no node in the graph carries', () => {
      const g = graph([rn({ id: 'a', kind: 'agent', dependsOn: ['ghost'] })])
      const map = layoutHall(g)
      const station = map.props.find((p) => p.nodeId === 'a')!
      // The ghost dependency still counts as one hop of depth (it just has no
      // depth of its own to add), and it produces no belt, since a belt needs
      // a source station and this one has none.
      expect(station.x).toBe(8)
      expect(map.belts).toEqual([])
    })

    it('breaks a cycle in dependsOn rather than recursing forever', () => {
      const g = graph([
        rn({ id: 'a', kind: 'agent', dependsOn: ['b'] }),
        rn({ id: 'b', kind: 'agent', dependsOn: ['a'] }),
      ])
      const map = layoutHall(g)
      expect(map.props.filter((p) => p.nodeId !== null)).toHaveLength(2)
    })

    it('lays out identically whether or not labels are given', () => {
      const g = graph([rn({ id: 'a', kind: 'agent' })])
      const withLabels = layoutHall(g, { a: 'Do the thing' })
      const withoutLabels = layoutHall(g)
      expect(withLabels).toEqual(withoutLabels)
    })

    it('hugs the width to at most a few columns past the last station', () => {
      const g = graph([
        rn({ id: 'a', kind: 'agent' }),
        rn({ id: 'b', kind: 'agent', dependsOn: ['a'] }),
        rn({ id: 'c', kind: 'agent', dependsOn: ['b'] }),
        rn({ id: 'd', kind: 'agent', dependsOn: ['c'] }),
        rn({ id: 'e', kind: 'agent', dependsOn: ['d'] }),
      ])
      const map = layoutHall(g)
      const lastStation = map.props.find((p) => p.nodeId === 'e') as HallProp
      const rightEdge = lastStation.x + lastStation.w
      expect(map.width - rightEdge).toBeLessThanOrEqual(3)
    })

    it('lays out an empty graph without throwing', () => {
      const map = layoutHall(graph([]))
      expect(map.props.filter((p) => p.nodeId !== null)).toEqual([])
      expect(map.belts).toEqual([])
      expect(map.width).toBeGreaterThan(0)
      expect(map.height).toBeGreaterThan(0)
    })
  })
})

function dependsTransitively(
  byId: Map<string, { dependsOn: readonly string[] }>,
  from: string,
  on: string
): boolean {
  const node = byId.get(from)
  if (node === undefined) return false
  if (node.dependsOn.includes(on)) return true
  return node.dependsOn.some((dep) => dependsTransitively(byId, dep, on))
}
