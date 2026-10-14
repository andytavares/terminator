/** The factory hall's run observation as its specs draw it: one running build station. */
import type { Crew, World } from '../../src/factory/sim.js'
import type { HallMap } from '../../src/factory/layout.js'

/** N-1, a builder's agent node at work in session s-1. */
export function hallNode(over: Record<string, unknown> = {}) {
  return {
    id: 'N-1',
    stepId: 'build',
    kind: 'agent',
    state: 'running',
    unitIds: [],
    lane: null,
    role: 'builder',
    dependsOn: [],
    attempts: 1,
    reworks: 0,
    feedback: [],
    sessionId: 's-1',
    worktreePath: null,
    startedAt: null,
    endedAt: null,
    ...over,
  }
}

/** What `foundry:run.observe` answers for WO-1 with only `hallNode()` on its graph. */
export function hallView(over: Record<string, unknown> = {}) {
  return {
    graph: { orderId: 'WO-1', recipe: 'standard', nodes: [hallNode()] },
    labels: { 'N-1': 'Build the thing' },
    ready: [],
    blocked: [],
    orphaned: [],
    stranded: [],
    waiting: [],
    ...over,
  }
}

/** A world on `map` with `crew` and nothing else going on: no crates, gates, calls or CI. */
export function idleWorld(map: HallMap, crew: Crew[] = []): World {
  return {
    map,
    crew,
    crates: [],
    gatesWaiting: [],
    openCalls: [],
    verdicts: [],
    clockMs: 0,
    ci: null,
    queue: null,
  }
}

/** A pull request at `url` whose checks are in `buckets`, one check each. */
export function pullRequestChecks(url: string, buckets: ('pass' | 'pending')[]) {
  return {
    url,
    checks: buckets.map((bucket, i) => ({ name: `check-${i}`, bucket, link: '', workflow: 'CI' })),
  }
}
