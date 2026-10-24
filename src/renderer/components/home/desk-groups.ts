import type { DeskCount } from './desk-filter'
import { focusFirst, groupThreads, type WorkThread } from '../../home/work-threads'

export type DeskGroupBy = 'move' | 'repo'

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

/** The Desk's lists, grouped by state or by repo; archived threads are left out. */
export function deskGroups(threads: readonly WorkThread[], groupBy: DeskGroupBy): DeskGroup[] {
  const shown = threads.filter((t) => !t.archived)
  return groupBy === 'move' ? byState(shown) : byRepo(shown)
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
    (t) => matchesText(t, filter.text) && (!filter.count || COUNT_MATCHES[filter.count](t))
  )
}
