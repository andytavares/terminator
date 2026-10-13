import { describe, it, expect } from 'vitest'
import * as fs from 'node:fs'
import * as path from 'node:path'
import { layoutHall, stationKind, SIGN_CHARS, TILE_PX } from '../../src/factory/layout.js'
import type { HallMap, HallProp, Tile } from '../../src/factory/layout.js'
import { findPath, distancesFrom } from '../../src/factory/path.js'
import { buildRunGraph } from '../../src/line/run-graph.js'
import type { RunGraph, RunNode } from '../../src/line/run-graph.js'
import { parseRecipe } from '../../src/recipe/parse.js'
import type { Recipe } from '../../src/recipe/parse.js'
import { draftOrder } from '../../src/order/draft.js'
import type { WorkOrder } from '../../src/order/schema.js'

// Two real recipes drive most of these tests, the same way
// tests/line/run-graph.spec.ts exercises buildRunGraph — this is a layout of
// an actual run graph, not of a hand-built fixture that only happens to look
// like one. The property tests sweep every recipe the repo ships, at every
// lane count.

const SHIPPED_RECIPES = path.join(__dirname, '..', '..', 'recipes')

function recipeFrom(file: string, dir = SHIPPED_RECIPES): Recipe {
  const text = fs.readFileSync(path.join(dir, file), 'utf-8')
  const parsed = parseRecipe(text, file)
  if (!parsed.ok) throw new Error(parsed.reason)
  return parsed.value
}

function unit(id: string, lane: number): WorkOrder['plan']['units'][number] {
  return {
    id,
    title: id,
    role: 'builder',
    lane,
    dependsOn: [],
    satisfies: ['AC-1'],
    touches: [],
    verify: [],
  }
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
    risk: { ...base.risk, triggers: ['migration'] },
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

function graphFor(recipeFile: string, lanes: number[], dir = SHIPPED_RECIPES): RunGraph {
  const recipe = recipeFrom(recipeFile, dir)
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
    reworks: 0,
    feedback: [],
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

const CREWED_KINDS = ['agent', 'fanout', 'run']
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

/** A run graph and the hall laid out for it. */
interface LaidOut {
  g: RunGraph
  map: HallMap
}

/** A run graph built from a shipped recipe. */
interface Fixture {
  graph: RunGraph
}

const RECIPE_FILES = fs.readdirSync(SHIPPED_RECIPES).filter((f) => f.endsWith('.yaml'))
const LANE_SETS: number[][] = [[1], [1, 2], [1, 2, 3], [1, 2, 3, 4, 5]]

/** The properties every hall keeps, for one recipe at one lane count. */
function laidOutTests(file: string, lanes: number[]) {
  const g = graphFor(file, lanes)
  const map = layoutHall(g)

  describe('seats', () => seatsTests({ g, map }))
  describe('belts and anchors', () => beltsAndAnchorsTests({ map }))
  describe('reachability', () => reachabilityTests({ map }))
  describe('belt paths', () => beltPathsTests({ map }))
  describe('no fallback and the back row', () => noFallbackAndTheBackRowTests({ map }))
  describe('wall fixtures', () => wallFixturesTests({ map }))
}

describe('layoutHall — properties, across every recipe and lane count', () => {
  for (const file of RECIPE_FILES) {
    for (const lanes of LANE_SETS) {
      describe(`${file} lanes=[${lanes.join(',')}]`, () => laidOutTests(file, lanes))
    }
  }

  describe('forks', forkTests)
})

function forkTests() {
  // a -> { b -> c, d } -> e: the short branch (d) skips a column, so it stands
  // on a second row beside b and runs straight to the merge at e.
  it('lays an uneven fork out without any belt falling back to the BFS path', () => {
    const map = layoutHall(
      graph([
        rn({ id: 'a', kind: 'agent' }),
        rn({ id: 'b', kind: 'agent', dependsOn: ['a'] }),
        rn({ id: 'c', kind: 'agent', dependsOn: ['b'] }),
        rn({ id: 'd', kind: 'agent', dependsOn: ['a'] }),
        rn({ id: 'e', kind: 'join', dependsOn: ['c', 'd'] }),
      ])
    )
    expect(map.belts.map((b) => b.id).sort()).toEqual(['a->b', 'a->d', 'b->c', 'c->e', 'd->e'])
    const blocked = blockedForBeltKeys(map)
    for (const belt of map.belts) {
      for (const t of belt.path) expect(blocked.has(`${t.x},${t.y}`)).toBe(false)
    }
    const at = (id: string): HallProp => map.props.find((p) => p.nodeId === id) as HallProp
    expect(at('d').x).toBe(at('b').x)
    expect(at('d').y).toBeGreaterThan(at('b').y)
    expect(at('c').y).toBe(at('b').y)
    const merge = map.belts.find((b) => b.id === 'd->e') as HallMap['belts'][number]
    expect(merge.path[merge.path.length - 1]).toEqual({ x: at('e').x - 1, y: at('e').y })
  })

  it('gives the 3-lane standard graph at least one split and one merge', () => {
    const map = layoutHall(graphFor('standard.yaml', [1, 2, 3]))
    const kinds = map.beltTiles.map((t) => t.kind)
    expect(kinds).toContain('split')
    expect(kinds).toContain('merge')
  })
}

function seatsTests({ g, map }: LaidOut) {
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
}

function beltsAndAnchorsTests({ map }: Pick<LaidOut, 'map'>) {
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

  // A gap between two yard stations is where a belt turns down to get
  // round the next one; an anchor standing in it forces a detour.
  it('stands the wait anchor under a station, never in a gap between two', () => {
    const { wait } = map.anchors
    expect(map.solid[wait.y - 1][wait.x]).toBe(true)
  })
}

function reachabilityTests({ map }: Pick<LaidOut, 'map'>) {
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
      const p = findPath(map.walk, { from: map.anchors.intake, to: target })
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
}

function beltPathsTests({ map }: Pick<LaidOut, 'map'>) {
  it('routes every belt as a 4-contiguous path from port to port', () => {
    expect(map.belts.length).toBeGreaterThan(0)
    const byNode = new Map(map.props.filter((p) => p.nodeId).map((p) => [p.nodeId as string, p]))
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
}

function noFallbackAndTheBackRowTests({ map }: Pick<LaidOut, 'map'>) {
  it('never falls back to the BFS path', () => {
    expect(map.belts.length).toBeGreaterThan(0)
    const blocked = blockedForBeltKeys(map)
    for (const belt of map.belts) {
      for (const t of belt.path) {
        expect(blocked.has(`${t.x},${t.y}`)).toBe(false)
      }
    }
  })

  // The row above a station is where its screens and its nameplate
  // are drawn; a crew member walking there is hidden behind both.
  it('never lets a crew member walk the row behind a station', () => {
    const stations = stationsOf(map.props)
    expect(stations.length).toBeGreaterThan(0)
    for (const s of stations) {
      for (let x = s.x; x < s.x + s.w; x++) expect(map.walk[s.y - 1][x]).toBe(true)
    }
  })
}

function wallFixturesTests({ map }: Pick<LaidOut, 'map'>) {
  it('gives the scoreboard three tiles, and no wall fixture overlaps another', () => {
    const board = map.props.find((p) => p.kind === 'statuswall') as HallProp
    expect(board.w).toBe(3)
    const wall = map.props.filter((p) =>
      ['shelves', 'racks', 'statuswall', 'lockers'].includes(p.kind)
    )
    for (const a of wall) {
      expect(a.x).toBeGreaterThanOrEqual(1)
      expect(a.x + a.w).toBeLessThanOrEqual(map.width - 1)
      for (const b of wall) {
        if (a === b) continue
        expect(a.x + a.w <= b.x || b.x + b.w <= a.x).toBe(true)
      }
    }
  })

  it('stands the archive and the rack under their own wall fixture', () => {
    const shelves = map.props.find((p) => p.kind === 'shelves') as HallProp
    const racks = map.props.find((p) => p.kind === 'racks') as HallProp
    expect(map.anchors.archive.x).toBe(shelves.x)
    expect(map.anchors.rack.x).toBe(racks.x)
    expect(map.anchors.archive.y).toBe(shelves.y + 1)
    expect(map.anchors.rack.y).toBe(racks.y + 1)
  })
}

describe('layoutHall', () => {
  const FIXTURES: { file: string; lanes: number[] }[] = [
    { file: 'standard.yaml', lanes: [1, 2] },
    { file: 'bugfix.yaml', lanes: [1] },
  ]

  for (const { file, lanes } of FIXTURES) {
    describe(file, () => {
      const graph = graphFor(file, lanes)

      describe('stations and rows', () => stationsAndRowsTests({ graph }))
      describe('depth', () => depthTests({ graph }))
      describe('clear floor and fixtures', () => clearFloorAndFixturesTests({ graph }))
      describe('determinism and skipped nodes', () => determinismAndSkippedNodesTests({ graph }))
    })
  }

  it('exposes TILE_PX as a positive pixel size', () => {
    expect(TILE_PX).toBeGreaterThan(0)
  })

  describe('hand-built graphs, for the shapes no real recipe happens to produce', () => {
    describe('no edges', noEdgesTests)
    describe('overlaps', overlapsTests)
    describe('the yard', theYardTests)
    describe('a single lane', aSingleLaneTests)
    describe('joins', joinsTests)
    describe('unknown dependencies and cycles', unknownDependenciesAndCyclesTests)
    describe('labels and width', labelsAndWidthTests)
    describe('empty graphs and towers', emptyGraphsAndTowersTests)
    describe('the rest of the map', theRestOfTheMapTests)
  })
})

function stationsAndRowsTests({ graph }: Fixture) {
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
}

function depthTests({ graph }: Fixture) {
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
}

function clearFloorAndFixturesTests({ graph }: Fixture) {
  it('gives archive, rack and wait a clear floor tile', () => {
    const map = layoutHall(graph)
    expect(map.solid[map.anchors.archive.y][map.anchors.archive.x]).toBe(false)
    expect(map.solid[map.anchors.rack.y][map.anchors.rack.x]).toBe(false)
    expect(map.solid[map.anchors.wait.y][map.anchors.wait.x]).toBe(false)
  })

  it('spreads the four wall fixtures across the width instead of one bay', () => {
    const map = layoutHall(graph)
    const fixtureKinds: HallProp['kind'][] = ['shelves', 'racks', 'statuswall', 'lockers']
    const fixtures = fixtureKinds.map((kind) => map.props.find((p) => p.kind === kind) as HallProp)
    expect(fixtures.every((f) => f !== undefined)).toBe(true)
    const xs = fixtures.map((f) => f.x)
    expect(new Set(xs).size).toBe(xs.length)
    const spread = Math.max(...xs) - Math.min(...xs)
    expect(spread).toBeGreaterThan(map.width / 3)
  })
}

function determinismAndSkippedNodesTests({ graph }: Fixture) {
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
}

function noEdgesTests() {
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
}

function overlapsTests() {
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
}

function theYardTests() {
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
}

function aSingleLaneTests() {
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
}

function joinsTests() {
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
}

function unknownDependenciesAndCyclesTests() {
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
}

function labelsAndWidthTests() {
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
}

function emptyGraphsAndTowersTests() {
  it('lays out an empty graph without throwing', () => {
    const map = layoutHall(graph([]))
    expect(map.props.filter((p) => p.nodeId !== null)).toEqual([])
    expect(map.belts).toEqual([])
    expect(map.width).toBeGreaterThan(0)
    expect(map.height).toBeGreaterThan(0)
  })

  it('draws no dispatch tower when the observation carries no CI', () => {
    const map = layoutHall(graph([rn({ id: 'a', kind: 'agent' })]))
    expect(map.props.some((p) => p.kind === 'dispatch')).toBe(false)
  })

  it('draws a dispatch tower at the exit only when CI is present', () => {
    const withCi = layoutHall(graph([rn({ id: 'a', kind: 'agent' })]), undefined, true)
    const dispatch = withCi.props.find((p) => p.kind === 'dispatch')
    expect(dispatch).toBeDefined()
    expect(dispatch?.y).toBe(withCi.anchors.exit.y)
  })
}

function theRestOfTheMapTests() {
  it('leaves the rest of the map unchanged by adding the dispatch tower', () => {
    const without = layoutHall(graph([rn({ id: 'a', kind: 'agent' })]))
    const withCi = layoutHall(graph([rn({ id: 'a', kind: 'agent' })]), undefined, true)
    const stationsOnly = (m: HallMap) => m.props.filter((p) => p.kind !== 'dispatch')
    expect(stationsOnly(withCi)).toEqual(stationsOnly(without))
    expect(withCi.width).toBe(without.width)
    expect(withCi.height).toBe(without.height)
  })
}

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

describe('layoutHall — station signs', () => {
  const map = layoutHall(graphFor('standard.yaml', [1, 2]))

  it('gives every station a sign that fits its width, and nothing else one', () => {
    const stations = map.props.filter((p) => ['desk', 'rig', 'press', 'gate'].includes(p.kind))
    expect(stations.length).toBeGreaterThan(0)
    for (const p of stations) {
      expect(p.sign, p.id).not.toBeNull()
      expect((p.sign as string).length, p.id).toBeLessThanOrEqual(
        SIGN_CHARS[p.kind as keyof typeof SIGN_CHARS]
      )
    }
    for (const p of map.props.filter((q) => !stations.includes(q))) expect(p.sign, p.id).toBeNull()
  })

  it('sizes each sign to the stencil the station has room for', () => {
    expect(SIGN_CHARS).toEqual({ desk: 12, press: 12, rig: 8, gate: 4 })
    for (const p of map.props.filter((q) => q.sign !== null)) {
      expect(SIGN_CHARS[p.kind as keyof typeof SIGN_CHARS]).toBe(
        Math.floor((p.w * TILE_PX + 1) / 4)
      )
    }
  })

  it("names a station from its own node's role and unit", () => {
    const g = graph([
      rn({ id: 'fix:U-1', kind: 'agent', role: 'builder', unitIds: ['U-1'], lane: 1 }),
    ])
    const laid = layoutHall(g)
    expect(laid.props.find((p) => p.nodeId === 'fix:U-1')?.sign).toBe('BUILDER U-1')
  })
})

const tileKey = (t: Tile): string => `${t.x},${t.y}`

/** A tile and the four it touches edge to edge. */
const withNeighbours = (t: Tile): Tile[] => [
  t,
  { x: t.x + 1, y: t.y },
  { x: t.x - 1, y: t.y },
  { x: t.x, y: t.y + 1 },
  { x: t.x, y: t.y - 1 },
]

const JUNCTIONS = new Set(['split', 'merge', 'corner'])

/** The tiles a crossover must keep clear of: stations, their seats and belt junctions. */
function stationAndJunctionTiles(map: HallMap): Set<string> {
  const blocked = new Set<string>()
  for (const p of stationsOf(map.props)) {
    for (let x = p.x; x < p.x + p.w; x++) {
      for (let y = p.y; y < p.y + p.h; y++) blocked.add(tileKey({ x, y }))
    }
    if (p.seat !== null) blocked.add(tileKey(p.seat))
  }
  for (const b of map.beltTiles) if (JUNCTIONS.has(b.kind)) blocked.add(tileKey(b))
  return blocked
}

/** Whether nothing a crossover must avoid is on or around `t`. */
function clearOf(map: HallMap, t: Tile): boolean {
  const blocked = stationAndJunctionTiles(map)
  for (let dx = -1; dx <= 1; dx++) {
    for (let dy = -1; dy <= 1; dy++) {
      if (blocked.has(tileKey({ x: t.x + dx, y: t.y + dy }))) return false
    }
  }
  return true
}

/** Whether the crossover at `t` has an open partner next to it along its belt. */
function pairedAlongBelt(map: HallMap, t: Tile): boolean {
  const open = new Set(map.crossovers.map(tileKey))
  const outs = map.beltTiles.find((b) => tileKey(b) === tileKey(t))?.outs ?? []
  const horizontal = outs.includes('E') || outs.includes('W')
  const mates = horizontal
    ? [
        { x: t.x - 1, y: t.y },
        { x: t.x + 1, y: t.y },
      ]
    : [
        { x: t.x, y: t.y - 1 },
        { x: t.x, y: t.y + 1 },
      ]
  return mates.some((m) => open.has(tileKey(m)))
}

const REAL_GRAPH: RunGraph = JSON.parse(
  fs.readFileSync(path.join(__dirname, 'fixtures', 'run-graph-real.json'), 'utf-8')
)

/** The real run graph, and every shipped recipe at three lanes. */
const CROSSOVER_CASES: { name: string; graph: RunGraph }[] = [
  { name: 'a real run graph', graph: REAL_GRAPH },
  ...RECIPE_FILES.map((file) => ({ name: file, graph: graphFor(file, [1, 2, 3]) })),
]

describe('layoutHall — crossovers sit clear of stations', () => {
  it('the real run graph opens at least one crossover', () => {
    expect(layoutHall(REAL_GRAPH).crossovers.length).toBeGreaterThan(0)
  })

  for (const { name, graph } of CROSSOVER_CASES) {
    describe(name, () => crossoverTests(name, layoutHall(graph)))
  }
})

function crossoverTests(name: string, map: HallMap) {
  // Only the real graph is asserted for pairing and clearance: on the shipped
  // recipes a belt may leave no clear pair, and the single-tile fallback keeps the floor whole.
  if (name === 'a real run graph') realCrossoverTests(map)

  it('still reaches every seat from the intake', () => {
    const seen = distancesFrom(map.walk, map.anchors.intake)
    for (const p of map.props.filter((q) => q.seat !== null)) {
      expect(withNeighbours(p.seat as Tile).some((t) => seen.has(tileKey(t)))).toBe(true)
    }
  })
}

function realCrossoverTests(map: HallMap) {
  it('opens crossovers as pairs of neighbouring tiles on one belt', () => {
    for (const t of map.crossovers) expect(pairedAlongBelt(map, t)).toBe(true)
  })

  it('keeps every crossover clear of stations, seats and belt junctions', () => {
    for (const t of map.crossovers) expect(clearOf(map, t)).toBe(true)
  })
}
