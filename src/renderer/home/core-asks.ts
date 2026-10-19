import type { HomeAsk, Sourced } from '../../shared/schemas/home-feed.schema'
import type { ChangeStats } from '../../shared/schemas/git.schema'
import type { ChoiceOption } from '../../shared/types/index'
import type { IssueTitles } from '../sidebar/session-filter'
import type { SessionFacts } from '../sidebar/session-facts'

/** An ask the Desk draws: from an extension's feed, or from a session core watches. */
export interface DeskAsk extends Sourced<HomeAsk> {
  sessionId?: string
  choices?: ChoiceOption[]
  /** Which repo and which work the ask is about, e.g. "terminator · TAV-31 Rate limit". */
  where?: string
}

/** The command the Desk runs to bring a session forward; core handles it, no extension does. */
export const REVEAL_SESSION_COMMAND = 'core:reveal-session'

const SEPARATOR = ' · '

/** The repo, then the ticket and its title, else the branch. The repo is the workspace (ADR 032). */
function whereOf(facts: SessionFacts, titles: IssueTitles): string {
  const ref = facts.workItem?.ref
  const work = ref
    ? [ref.key, titles.get(`${ref.tracker}:${ref.key}`)].filter(Boolean).join(' ')
    : facts.branch
  return [facts.workspaceName, work].filter(Boolean).join(SEPARATOR)
}

function itemId(kind: HomeAsk['kind'], facts: SessionFacts): string {
  return `core:${kind}:${facts.sessionId}:${facts.lastActivityAt}`
}

function baseAsk(facts: SessionFacts, titles: IssueTitles): Omit<DeskAsk, 'id' | 'kind'> {
  return {
    source: 'core',
    title: '',
    detail: '',
    facts: [],
    workKey: null,
    since: new Date(facts.lastActivityAt).toISOString(),
    actions: [],
    open: { command: REVEAL_SESSION_COMMAND, args: { sessionId: facts.sessionId } },
    sessionId: facts.sessionId,
    where: whereOf(facts, titles),
  }
}

function answerAsk(facts: SessionFacts, titles: IssueTitles): DeskAsk {
  const choices = facts.choicePrompt?.options ?? []
  const picks = choices.map((c) => ({ id: `choice-${c.number}`, label: c.label }))
  return {
    ...baseAsk(facts, titles),
    id: itemId('answer', facts),
    kind: 'answer',
    title: 'Agent is asking',
    detail: facts.choicePrompt?.question ?? facts.askMessage ?? facts.latestLine,
    actions: [...picks, { id: 'reply', label: 'Reply', primary: picks.length === 0 }],
    ...(choices.length > 0 ? { choices } : {}),
  }
}

/** The agent's first prompt is not exposed to the renderer, so the description stands in. */
function finishedAsk(facts: SessionFacts, titles: IssueTitles): DeskAsk {
  return {
    ...baseAsk(facts, titles),
    id: itemId('finished', facts),
    kind: 'finished',
    title: 'Agent finished',
    detail: facts.description ?? facts.branch ?? '',
    actions: [{ id: 'review-changes', label: 'Review changes', primary: true }],
  }
}

function finishedWhileAway(facts: SessionFacts): boolean {
  return (
    facts.state === 'idle' &&
    facts.agent !== null &&
    !facts.isClosed &&
    facts.lastActivityAt > (facts.lastAttendedAt ?? 0)
  )
}

/** Asks core raises itself: a session waiting on you, and one that finished while you were away. */
export function coreAsksFrom(facts: readonly SessionFacts[], titles: IssueTitles): DeskAsk[] {
  return facts.flatMap((f) => {
    if (f.isClosed) return []
    if (f.state === 'awaiting-input') return [answerAsk(f, titles)]
    return finishedWhileAway(f) ? [finishedAsk(f, titles)] : []
  })
}

/** The facts line under a finished ask, from the branch's uncommitted change stats. */
export function finishedFacts(stats: ChangeStats | null): string[] {
  if (stats === null || stats.files === 0) return []
  const files = `${stats.files} ${stats.files === 1 ? 'file' : 'files'}`
  return [files, `+${stats.added} −${stats.removed}`]
}
