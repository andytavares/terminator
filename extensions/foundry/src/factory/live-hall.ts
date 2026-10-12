import { layoutHall } from './layout.js'
import type { HallMap } from './layout.js'
import { createWorld } from './sim.js'
import type { World } from './sim.js'
import { diffObservation } from './events.js'
import type { FactoryEvent, Observation } from './events.js'
import { direct } from './director.js'
import { createBeats, release, schedule } from './beats.js'
import type { Beats } from './beats.js'
import type { NodeState, RunGraph } from '../line/run-graph.js'

// The hall of a run as it is now: the world the scene draws, and the beats
// that hold what happened until it can play out in order.
//
// It lives outside React because the world moves every animation frame and is
// written back by the scene itself, while the parts a render needs — the map,
// the states the stations show, the queue — change only when an observation
// or a due beat says so. A component subscribes to exactly those.

export function statesOf(graph: RunGraph): Record<string, NodeState> {
  return Object.fromEntries(graph.nodes.map((n) => [n.id, n.state]))
}

/** What a render of the live hall needs; replaced, never mutated, when it changes. */
export interface LiveScene {
  readonly map: HallMap | null
  /** What each station is showing: the states the beat scheduler has released so far. */
  readonly shown: Readonly<Record<string, NodeState>>
  readonly queue: World['queue']
}

type Labels = Readonly<Record<string, string>>
type EventsListener = (events: readonly FactoryEvent[], labels: Labels) => void

export interface LiveHall {
  /** Read and written every frame by the scene; null until the first observation. */
  readonly world: { current: World | null }
  readonly subscribe: (listener: () => void) => () => void
  readonly snapshot: () => LiveScene
  /** Told of every batch of events the director has played. Returns its own undoing. */
  readonly onEvents: (listener: EventsListener) => () => void
  readonly observe: (observation: Observation, labels: Labels, nowMs: number) => void
  /** Plays the held beats that have come due, when no observation is there to carry them. */
  readonly releaseDue: (labels: Labels, nowMs: number) => void
}

function mapKeyOf(observation: Observation): string {
  // CI presence joins the key: the dispatch tower has to appear the moment a
  // run first ships a pull, not only the next time the node set changes.
  return (
    [...observation.graph.nodes.map((n) => n.id)].sort().join(',') +
    (observation.ci === null ? '' : '+ci')
  )
}

export function createLiveHall(): LiveHall {
  const world: { current: World | null } = { current: null }
  let scene: LiveScene = { map: null, shown: {}, queue: null }
  let mapKey: string | null = null
  let previous: Observation | null = null
  let beats: Beats | null = null
  const sceneListeners = new Set<() => void>()
  const eventListeners = new Set<EventsListener>()

  function publish(next: Partial<LiveScene>): void {
    const merged = { ...scene, ...next }
    if (merged.map === scene.map && merged.shown === scene.shown && merged.queue === scene.queue)
      return
    scene = merged
    for (const listener of sceneListeners) listener()
  }

  function play(released: ReturnType<typeof release>, nowMs: number): void {
    beats = released.beats
    world.current = direct(world.current as World, released.events, nowMs)
    publish({ shown: released.beats.shown, queue: world.current.queue })
  }

  function rebuild(observation: Observation, labels: Labels, key: string): void {
    const map = layoutHall(observation.graph, labels, observation.ci !== null)
    mapKey = key
    world.current = createWorld(map, observation)
    previous = observation
    beats = createBeats(statesOf(observation.graph))
    publish({ map, shown: beats.shown, queue: world.current.queue })
  }

  return {
    world,
    subscribe(listener) {
      sceneListeners.add(listener)
      return () => sceneListeners.delete(listener)
    },
    snapshot: () => scene,
    onEvents(listener) {
      eventListeners.add(listener)
      return () => eventListeners.delete(listener)
    },
    observe(observation, labels, nowMs) {
      const key = mapKeyOf(observation)
      if (mapKey !== key) return rebuild(observation, labels, key)
      const seen = diffObservation(previous, observation)
      const held = schedule(beats as Beats, seen, observation.graph.nodes, nowMs)
      const released = release(held, nowMs)
      play(released, nowMs)
      previous = observation
      for (const listener of eventListeners) listener(released.events, labels)
    },
    releaseDue(labels, nowMs) {
      if (beats === null || beats.held.length === 0 || world.current === null) return
      const released = release(beats, nowMs)
      if (released.events.length === 0) return
      play(released, nowMs)
      for (const listener of eventListeners) listener(released.events, labels)
    },
  }
}
