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

// A run's hall as it is now: the world the scene draws, and beats holding events until
// they can play in order. Outside React: the world moves every frame, but what a render
// needs changes only on an observation or a due beat, and a component subscribes to that.

export function statesOf(graph: RunGraph): Record<string, NodeState> {
  return Object.fromEntries(graph.nodes.map((n) => [n.id, n.state]))
}

/** What a render of the live hall needs; replaced, never mutated, when it changes. */
interface LiveScene {
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
  const hall = new LiveHallState()
  return {
    world: hall.world,
    subscribe(listener) {
      hall.sceneListeners.add(listener)
      return () => hall.sceneListeners.delete(listener)
    },
    snapshot: () => hall.scene,
    onEvents(listener) {
      hall.eventListeners.add(listener)
      return () => hall.eventListeners.delete(listener)
    },
    observe: (observation, labels, nowMs) => hall.observeRun(observation, { labels, nowMs }),
    releaseDue: (labels, nowMs) => hall.releaseDue(labels, nowMs),
  }
}

/** One live hall's world, scene, beats and listeners. */
class LiveHallState {
  readonly world: { current: World | null } = { current: null }
  scene: LiveScene = { map: null, shown: {}, queue: null }
  readonly sceneListeners = new Set<() => void>()
  readonly eventListeners = new Set<EventsListener>()
  private mapKey: string | null = null
  private previous: Observation | null = null
  private beats: Beats | null = null

  private publish(next: Partial<LiveScene>): void {
    const { scene } = this
    const merged = { ...scene, ...next }
    if (merged.map === scene.map && merged.shown === scene.shown && merged.queue === scene.queue)
      return
    this.scene = merged
    for (const listener of this.sceneListeners) listener()
  }

  private playReleased(released: ReturnType<typeof release>, nowMs: number): void {
    this.beats = released.beats
    this.world.current = direct(this.world.current as World, released.events, nowMs)
    this.publish({ shown: released.beats.shown, queue: this.world.current.queue })
  }

  private rebuild(observation: Observation, labels: Labels, key: string): void {
    const map = layoutHall(observation.graph, labels, observation.ci !== null)
    this.mapKey = key
    this.world.current = createWorld(map, observation)
    this.previous = observation
    this.beats = createBeats(statesOf(observation.graph))
    this.publish({ map, shown: this.beats.shown, queue: this.world.current.queue })
  }

  observeRun(observation: Observation, { labels, nowMs }: { labels: Labels; nowMs: number }): void {
    const key = mapKeyOf(observation)
    if (this.mapKey !== key) return this.rebuild(observation, labels, key)
    const seen = diffObservation(this.previous, observation)
    const held = schedule(
      this.beats as Beats,
      { events: seen, nodes: observation.graph.nodes },
      nowMs
    )
    const released = release(held, nowMs)
    this.playReleased(released, nowMs)
    this.previous = observation
    for (const listener of this.eventListeners) listener(released.events, labels)
  }

  releaseDue(labels: Labels, nowMs: number): void {
    const { beats } = this
    if (beats === null || beats.held.length === 0 || this.world.current === null) return
    const released = release(beats, nowMs)
    if (released.events.length === 0) return
    this.playReleased(released, nowMs)
    for (const listener of this.eventListeners) listener(released.events, labels)
  }
}
