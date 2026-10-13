import { describe, it, expect, vi } from 'vitest'
import { createLiveHall } from '../../src/factory/live-hall.js'
import { MIN_DWELL_MS } from '../../src/factory/beats.js'
import { buildRunGraph, withNode } from '../../src/line/run-graph.js'
import type { RunGraph } from '../../src/line/run-graph.js'
import { parseRecipe } from '../../src/recipe/parse.js'
import { draftOrder } from '../../src/order/draft.js'
import type { Observation } from '../../src/factory/events.js'

// The live hall holds the world and the beats outside React. What a render
// reads from it changes only when an observation or a due beat says so.

const RECIPE = `
schemaVersion: 1
id: standard
steps:
  - id: a
    kind: agent
    role: builder
  - id: b
    kind: agent
    role: builder
    after: [a]
`

function standardGraph(): RunGraph {
  const parsed = parseRecipe(RECIPE, 'standard.yaml')
  if (!parsed.ok) throw new Error(parsed.reason)
  const order = draftOrder({
    id: 'WO-1',
    title: 'x',
    source: { kind: 'typed', tracker: null, key: null, url: null },
    repoPaths: ['/repos/a'],
    now: '2026-09-06T10:00:00.000Z',
  })
  return buildRunGraph(order, parsed.value)
}

function observation(g: RunGraph, over: Partial<Observation> = {}): Observation {
  return {
    graph: g,
    orphaned: [],
    stranded: [],
    waiting: [],
    activity: {},
    ci: null,
    queue: null,
    ...over,
  }
}

const graphWithARunning = (): RunGraph => withNode(standardGraph(), 'a', { state: 'running' })
/** `a` has passed and `b` has begun, in the same poll. */
const handedOver = (): RunGraph =>
  withNode(withNode(standardGraph(), 'a', { state: 'passed' }), 'b', { state: 'running' })

describe('createLiveHall', () => {
  describe('before and after the first observation', beforeAndAfterTheFirstObservationTests)
  describe('dwell', dwellTests)
  describe('subscribers', subscribersTests)
  describe('unsubscribing', unsubscribingTests)
  describe('played events', playedEventsTests)
  describe('queue and relayout', queueAndRelayoutTests)
})

function beforeAndAfterTheFirstObservationTests() {
  it('is empty until it has been shown a run', () => {
    const hall = createLiveHall()
    expect(hall.snapshot().map).toBeNull()
    expect(hall.world.current).toBeNull()
  })

  it('lays out the hall and creates the world from the first observation', () => {
    const hall = createLiveHall()
    hall.observe(observation(graphWithARunning()), {}, 0)
    expect(hall.snapshot().map).not.toBeNull()
    expect(hall.world.current).not.toBeNull()
    expect(hall.snapshot().shown.a).toBe('running')
    expect(hall.snapshot().shown.b).toBe('waiting')
  })
}

function dwellTests() {
  it('shows a step that passed at once, and holds the step behind it for the dwell', () => {
    const hall = createLiveHall()
    hall.observe(observation(graphWithARunning()), {}, 0)
    hall.observe(observation(handedOver()), {}, 1000)
    expect(hall.snapshot().shown).toMatchObject({ a: 'passed', b: 'waiting' })

    hall.releaseDue({}, 1000 + MIN_DWELL_MS - 1)
    expect(hall.snapshot().shown.b).toBe('waiting')

    hall.releaseDue({}, 1000 + MIN_DWELL_MS)
    expect(hall.snapshot().shown.b).toBe('running')
  })
}

function subscribersTests() {
  it('tells subscribers when the scene changes, and not when nothing came due', () => {
    const hall = createLiveHall()
    const changed = vi.fn()
    hall.subscribe(changed)
    hall.observe(observation(graphWithARunning()), {}, 0)
    expect(changed).toHaveBeenCalledTimes(1)

    hall.observe(observation(handedOver()), {}, 1000)
    expect(changed).toHaveBeenCalledTimes(2)

    hall.releaseDue({}, 1001)
    expect(changed).toHaveBeenCalledTimes(2)
    hall.releaseDue({}, 1000 + MIN_DWELL_MS)
    expect(changed).toHaveBeenCalledTimes(3)
  })

  it('does not tell subscribers when the same run is observed again unchanged', () => {
    const hall = createLiveHall()
    const g = graphWithARunning()
    hall.observe(observation(g), {}, 0)
    const changed = vi.fn()
    hall.subscribe(changed)

    hall.observe(observation(g), {}, 500)
    expect(changed).not.toHaveBeenCalled()
  })
}

function unsubscribingTests() {
  it('stops telling a subscriber that unsubscribed', () => {
    const hall = createLiveHall()
    const changed = vi.fn()
    hall.subscribe(changed)()
    hall.observe(observation(graphWithARunning()), {}, 0)
    expect(changed).not.toHaveBeenCalled()
  })
}

function playedEventsTests() {
  it('hands the events it played, with the labels, to the listeners', () => {
    const hall = createLiveHall()
    const heard = vi.fn()
    hall.onEvents(heard)
    hall.observe(observation(graphWithARunning()), {}, 0)
    expect(heard).not.toHaveBeenCalled()

    hall.observe(observation(handedOver()), { a: 'Build' }, 1000)
    expect(heard).toHaveBeenCalledTimes(1)
    const [events, labels] = heard.mock.calls[0]
    expect(events[0]).toEqual({ kind: 'node-state', nodeId: 'a', from: 'running', to: 'passed' })
    expect(labels).toEqual({ a: 'Build' })

    hall.releaseDue({}, 1000 + MIN_DWELL_MS)
    expect(heard).toHaveBeenCalledTimes(2)
  })
}

function queueAndRelayoutTests() {
  it('reflects the refinery queue it was told of', () => {
    const hall = createLiveHall()
    hall.observe(observation(graphWithARunning()), {}, 0)
    expect(hall.snapshot().queue).toBeNull()

    const queue = { position: 2, behind: [{ orderId: 'WO-2', title: 'Other', files: ['x.ts'] }] }
    hall.observe(observation(graphWithARunning(), { queue }), {}, 100)
    expect(hall.snapshot().queue).toEqual({ position: 2, behind: ['Other'] })
  })

  it('lays the hall out again when the nodes change', () => {
    const hall = createLiveHall()
    hall.observe(observation(graphWithARunning()), {}, 0)
    const first = hall.snapshot().map
    const fewer = { ...graphWithARunning(), nodes: graphWithARunning().nodes.slice(0, 1) }
    hall.observe(observation(fewer), {}, 100)
    expect(hall.snapshot().map).not.toBe(first)
  })
}
