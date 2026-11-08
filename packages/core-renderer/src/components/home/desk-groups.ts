import type { DeskCount } from './desk-filter'
import type { TaskState } from '../../home/task-state'
import { focusFirst, groupThreads, type WorkThread } from '../../home/work-threads'

export type DeskGroupBy = 'move' | 'repo' | 'none'

export interface DeskGroup {
  id: string
  label: string
  /** The dot before the heading: agents are at work, everything else is waiting. */
  tone: 'working' | 'muted'
  /** Collapsed until the operator opens it. */
  collapsible: boolean
  /** Said after the count in a collapsible group's heading. */
  note?: string
  threads: WorkThread[]
}

export const DESK_GROUP_OPTIONS: ReadonlyArray<readonly [DeskGroupBy, string]> = [
  ['move', 'state'],
  ['repo', 'repo'],
  ['none', 'none'],
]

const NO_REPO_LABEL = 'Scratch terminals'

function byState(threads: readonly WorkThread[]): DeskGroup[] {
  return groupThreads(threads).map((group) => ({
    id: group.id,
    label: group.label,
    tone: group.id === 'running' ? 'working' : 'muted',
    collapsible: false,
    threads: group.threads,
  }))
}

function byRepo(threads: readonly WorkThread[]): DeskGroup[] {
  const repos = new Map<string, WorkThread[]>()
  for (const thread of threads) {
    const repo = thread.lanes[0]?.repoName ?? NO_REPO_LABEL
    repos.set(repo, [...(repos.get(repo) ?? []), thread])
  }
  return [...repos.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([repo, inRepo]) => ({
      id: `repo:${repo}`,
      label: repo,
      tone: 'muted' as const,
      collapsible: false,
      threads: inRepo.sort(focusFirst),
    }))
}

function inOneGroup(threads: readonly WorkThread[]): DeskGroup[] {
  const all = [...threads].sort(focusFirst)
  return all.length === 0
    ? []
    : [{ id: 'all', label: 'All', tone: 'muted', collapsible: false, threads: all }]
}

const GROUPERS: Record<DeskGroupBy, (threads: readonly WorkThread[]) => DeskGroup[]> = {
  move: byState,
  repo: byRepo,
  none: inOneGroup,
}

/** The Desk's lists, grouped by state, by repo or not at all; archived threads are left out. */
export function deskGroups(threads: readonly WorkThread[], groupBy: DeskGroupBy): DeskGroup[] {
  return GROUPERS[groupBy](threads.filter((t) => !t.archived))
}

/** The states whose tasks need no attention, so the Tasks list folds them to one line. */
const FOLDED_STATES: readonly string[] = ['quiet', 'done']

/** The Tasks list's groups: those of the Desk, with Quiet and Done folded when grouped by state. */
export function taskGroups(threads: readonly WorkThread[], groupBy: DeskGroupBy): DeskGroup[] {
  return deskGroups(threads, groupBy).map((group) => ({
    ...group,
    collapsible: groupBy === 'move' && FOLDED_STATES.includes(group.id),
  }))
}

/** The keys of the rows on screen, top to bottom; a collapsed group shows none. */
export function visibleThreadKeys(groups: readonly DeskGroup[], expandedIds: readonly string[]) {
  return groups
    .filter((group) => !group.collapsible || expandedIds.includes(group.id))
    .flatMap((group) => group.threads.map((thread) => thread.key))
}

export interface DeskFilterValue {
  text: string
  count: DeskCount | null
  /** The state pressed on the Tasks layout's pulse line. */
  taskState?: TaskState | null
}

const failingFilter = (t: WorkThread): boolean => t.prChip?.tone === 'bad'

const COUNT_MATCHES: Record<DeskCount, (thread: WorkThread) => boolean> = {
  'your-move': (t) => t.state === 'needs-you',
  agents: (t) => t.state === 'running',
  others: (t) => t.state === 'waiting',
  failing: failingFilter,
}

function matchesText(thread: WorkThread, text: string): boolean {
  const needle = text.trim().toLowerCase()
  const lanes = thread.lanes.flatMap((lane) => [lane.branch, lane.repoName])
  const haystack = [thread.title, thread.ticketKey, thread.nowLine, ...lanes]
  return needle === '' || haystack.some((part) => part?.toLowerCase().includes(needle))
}

/** The threads the Desk's search box and the summary counts leave showing. */
export function filterThreads(threads: readonly WorkThread[], filter: DeskFilterValue) {
  return threads.filter(
    (t) =>
      matchesText(t, filter.text) &&
      (!filter.count || COUNT_MATCHES[filter.count](t)) &&
      (!filter.taskState || t.state === filter.taskState)
  )
}
