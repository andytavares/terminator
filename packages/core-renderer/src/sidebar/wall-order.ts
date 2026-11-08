import { byRecentlyOpened, byStarted, type SessionFacts } from './session-facts'
import type { WallPrefs } from './wall-prefs'
import { standingRank } from './view-model'

export interface WallPlacement {
  sessionId: string
  band: 'needs' | 'rest'
  /** CSS `order`. 0 is the Needs you heading and `needsCount + 1` the heading after it. */
  order: number
  span: 1 | 2
}

export interface WallLayout {
  placements: WallPlacement[]
  needsCount: number
  /** One heading per task when the wall is ordered by task; empty for every other order. */
  taskBands: WallTaskBand[]
}

/** The stored task a session's branch belongs to. */
export interface WallTask {
  id: string
  title: string
}

export interface WallTaskBand {
  title: string
  /** CSS `order` of the heading, one before its first tile. */
  order: number
  repoCount: number
  terminalCount: number
}

const NOT_IN_A_TASK = 'Not in a task'

function thenBy(prefs: WallPrefs, tasks: ReadonlyMap<string, WallTask>) {
  return (a: SessionFacts, b: SessionFacts): number => {
    if (prefs.thenBy === 'task') return byTask(tasks)(a, b)
    if (prefs.thenBy === 'recent') return byRecentlyOpened(a, b)
    if (prefs.thenBy === 'workspace-project') {
      const where = (f: SessionFacts) => `${f.workspaceName ?? ''}/${f.projectName ?? ''}/${f.name}`
      return where(a).localeCompare(where(b)) || byStarted(a, b)
    }
    return standingRank(a.state) - standingRank(b.state) || byStarted(a, b)
  }
}

interface RestOrder {
  orderOf: Map<string, number>
  taskBands: WallTaskBand[]
}

/** The tiles of one band: a task's, or those in no task. */
function bandOf(title: string, order: number, tiles: readonly SessionFacts[]): WallTaskBand {
  const repos = new Set(tiles.map((f) => f.workspaceName ?? ''))
  return { title, order, repoCount: repos.size, terminalCount: tiles.length }
}

/** Tasks by title, tiles in no task last, each in the order it was started. */
function byTask(tasks: ReadonlyMap<string, WallTask>) {
  const taskOf = (f: SessionFacts) => tasks.get(f.sessionId) ?? null
  return (a: SessionFacts, b: SessionFacts): number => {
    const [taskA, taskB] = [taskOf(a), taskOf(b)]
    if (taskA?.id === taskB?.id) return byStarted(a, b)
    if (taskA === null || taskB === null) return taskA === null ? 1 : -1
    // Two tasks can share a title; the id keeps each one's tiles in one run.
    return taskA.title.localeCompare(taskB.title) || taskA.id.localeCompare(taskB.id)
  }
}

interface TaskRun {
  taskId: string | null
  title: string
  tiles: SessionFacts[]
}

/** The tiles split into runs of one task each, or of tiles in no task. */
function runsByTask(rest: readonly SessionFacts[], tasks: ReadonlyMap<string, WallTask>) {
  const runs: TaskRun[] = []
  for (const f of rest) {
    const task = tasks.get(f.sessionId)
    const last = runs[runs.length - 1]
    if (last !== undefined && last.taskId === (task?.id ?? null)) last.tiles.push(f)
    else runs.push({ taskId: task?.id ?? null, title: task?.title ?? NOT_IN_A_TASK, tiles: [f] })
  }
  return runs
}

/** Gives each tile a slot from `first` on, and each run of a task's tiles a heading slot before it. */
function orderByTask(
  rest: readonly SessionFacts[],
  first: number,
  tasks: ReadonlyMap<string, WallTask>
): RestOrder {
  const orderOf = new Map<string, number>()
  const taskBands: WallTaskBand[] = []
  let slot = first
  for (const run of runsByTask(rest, tasks)) {
    taskBands.push(bandOf(run.title, slot++, run.tiles))
    for (const f of run.tiles) orderOf.set(f.sessionId, slot++)
  }
  return { orderOf, taskBands: taskBands.some((b) => b.title !== NOT_IN_A_TASK) ? taskBands : [] }
}

/** Slots in the order the tiles sort, from `first` on. */
function orderPlain(rest: readonly SessionFacts[], first: number): RestOrder {
  return { orderOf: new Map(rest.map((f, i) => [f.sessionId, first + i])), taskBands: [] }
}

/**
 * Where each live tile goes.
 *
 * The placements are emitted in session id order whatever the arrangement, and
 * position is carried by `order` and `span` alone. `mountPreview` moves a
 * session's one live terminal into its tile, so a tile that React reordered or
 * re-parented would lose its preview mid-move; with a stable emission order a
 * state change rewrites two style properties and nothing else (ADR 036, 054).
 */
export function placeWall(
  facts: readonly SessionFacts[],
  prefs: WallPrefs,
  tasks: ReadonlyMap<string, WallTask> = new Map()
): WallLayout {
  const open = facts.filter((f) => !f.isClosed)
  const needs = prefs.pinNeeds
    ? open.filter((f) => f.state === 'awaiting-input').sort(byStarted)
    : []
  const needsIds = new Set(needs.map((f) => f.sessionId))
  const rest = open.filter((f) => !needsIds.has(f.sessionId)).sort(thenBy(prefs, tasks))

  const first = needs.length + 2
  const placed = prefs.thenBy === 'task' ? orderByTask(rest, first, tasks) : orderPlain(rest, first)
  const orderOf = new Map(placed.orderOf)
  needs.forEach((f, i) => orderOf.set(f.sessionId, i + 1))

  const placements = [...open]
    .sort((a, b) => a.sessionId.localeCompare(b.sessionId))
    .map((f): WallPlacement => {
      const pinned = needsIds.has(f.sessionId)
      return {
        sessionId: f.sessionId,
        band: pinned ? 'needs' : 'rest',
        order: orderOf.get(f.sessionId)!,
        span: pinned ? 2 : 1,
      }
    })

  return { placements, needsCount: needs.length, taskBands: placed.taskBands }
}
