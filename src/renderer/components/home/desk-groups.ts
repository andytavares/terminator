import { groupThreads, type WorkThread } from '../../home/work-threads'

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
  ['move', 'whose move'],
  ['repo', 'repo'],
]

const PARKED_NOTE = 'scratch terminals and work untouched for 2 days'
const NO_REPO_LABEL = 'Scratch terminals'

function byWhoseMove(threads: readonly WorkThread[]): DeskGroup[] {
  return groupThreads(threads).map((group) => ({
    id: group.id,
    label: group.label,
    tone: group.id === 'agents' ? 'working' : 'muted',
    collapsible: group.id === 'parked',
    ...(group.id === 'parked' ? { note: PARKED_NOTE } : {}),
    threads: group.threads,
  }))
}

function byRepo(threads: readonly WorkThread[]): DeskGroup[] {
  const repos = new Map<string, WorkThread[]>()
  for (const thread of threads) {
    const repo = thread.repoName ?? NO_REPO_LABEL
    repos.set(repo, [...(repos.get(repo) ?? []), thread])
  }
  return [...repos.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([repo, inRepo]) => ({
      id: `repo:${repo}`,
      label: repo,
      tone: 'muted' as const,
      collapsible: false,
      threads: inRepo.sort((a, b) => b.lastActivity - a.lastActivity),
    }))
}

/** The Desk's lists, grouped by whose move it is or by repo. */
export function deskGroups(threads: readonly WorkThread[], groupBy: DeskGroupBy): DeskGroup[] {
  return groupBy === 'move' ? byWhoseMove(threads) : byRepo(threads)
}

/** The keys of the rows on screen, top to bottom; a collapsed group shows none. */
export function visibleThreadKeys(groups: readonly DeskGroup[], expandedIds: readonly string[]) {
  return groups
    .filter((group) => !group.collapsible || expandedIds.includes(group.id))
    .flatMap((group) => group.threads.map((thread) => thread.key))
}

export type DeskCount = 'your-move' | 'agents' | 'others' | 'failing'

export interface DeskFilterValue {
  text: string
  count: DeskCount | null
}

const agentsGroupFilter = (t: WorkThread): boolean => !t.parked && t.whoseMove !== 'others'
const failingFilter = (t: WorkThread): boolean => t.prChip?.tone === 'bad'

const COUNT_MATCHES: Record<DeskCount, (thread: WorkThread) => boolean> = {
  'your-move': (t) => t.whoseMove === 'you',
  agents: agentsGroupFilter,
  others: (t) => !t.parked && t.whoseMove === 'others',
  failing: failingFilter,
}

function matchesText(thread: WorkThread, text: string): boolean {
  const needle = text.trim().toLowerCase()
  const haystack = [thread.title, thread.ticketKey, thread.branch, thread.repoName, thread.nowLine]
  return needle === '' || haystack.some((part) => part?.toLowerCase().includes(needle))
}

/** The threads the Desk's search box and the summary counts leave showing. */
export function filterThreads(threads: readonly WorkThread[], filter: DeskFilterValue) {
  return threads.filter(
    (t) => matchesText(t, filter.text) && (!filter.count || COUNT_MATCHES[filter.count](t))
  )
}
