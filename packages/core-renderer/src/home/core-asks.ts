import type { HomeAsk, Sourced } from '../../../core-shared/src/schemas/home-feed.schema'
import type { ChangeStats } from '../../../core-shared/src/schemas/git.schema'
import type { ChoiceOption } from '../../../core-shared/src/types/index'
import type { IssueTitles } from '../sidebar/session-filter'
import type { SessionFacts } from '../sidebar/session-facts'

/** An ask the Desk draws: from an extension's feed, or from a session core watches. */
export interface DeskAsk extends Sourced<HomeAsk> {
  sessionId?: string
  choices?: ChoiceOption[]
  /** Which repo and which work the ask is about, e.g. "terminator · TAV-31 Rate limit". */
  where?: string
  /** True when core guessed the session is asking (a bell, a choice on screen) rather than being told. */
  inferred?: boolean
  /** What core read to guess it: a bell, or a numbered choice on screen. Set with `inferred`. */
  askSignal?: 'bell' | 'choice'
}

/** Why an inferred ask is only a guess, in words for the row. */
export const ASK_SIGNAL_REASONS: Record<NonNullable<DeskAsk['askSignal']>, string> = {
  choice: 'a numbered choice is on screen',
  bell: 'the terminal rang its bell',
}

/** The command the Desk runs to bring a session forward; core handles it, no extension does. */
export const REVEAL_SESSION_COMMAND = 'core:reveal-session'

const SEPARATOR = ' · '

/** The repo, then the ticket and its title, else the branch. The repo is the workspace (ADR 032). */
function whereOf(facts: SessionFacts, titles: IssueTitles): string {
  if (!facts.workspaceName) return `Scratch terminal · tab “${facts.name}”`
  const ref = facts.workItem?.ref
  const work = ref
    ? [ref.key, titles.get(`${ref.tracker}:${ref.key}`)].filter(Boolean).join(' ')
    : (facts.branch ?? facts.name)
  return [facts.workspaceName, work].filter(Boolean).join(SEPARATOR)
}

function itemId(kind: HomeAsk['kind'], facts: SessionFacts, at: number): string {
  return `core:${kind}:${facts.sessionId}:${at}`
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
    id: itemId('answer', facts, facts.lastActivityAt),
    kind: 'answer',
    title: 'Agent is asking',
    detail: facts.choicePrompt?.question ?? facts.askMessage ?? facts.latestLine,
    actions: [...picks, { id: 'reply', label: 'Reply', primary: picks.length === 0 }],
    ...(choices.length > 0 ? { choices } : {}),
    ...(facts.askInferred ? { inferred: true, askSignal: facts.askSignal ?? undefined } : {}),
  }
}

/** The agent's first prompt is not exposed to the renderer, so the description stands in. */
function finishedAsk(facts: SessionFacts, turnEndedAt: number, titles: IssueTitles): DeskAsk {
  return {
    ...baseAsk(facts, titles),
    id: itemId('finished', facts, turnEndedAt),
    since: new Date(turnEndedAt).toISOString(),
    kind: 'finished',
    title: 'Agent finished',
    detail: facts.description ?? lastOutputOf(facts) ?? facts.branch ?? '',
    actions: [{ id: 'review-changes', label: 'Review changes', primary: true }],
  }
}

function lastOutputOf(facts: SessionFacts): string | null {
  return facts.latestLine !== '' ? `Last output: ${facts.latestLine}` : null
}

/** When the agent's turn ended unseen. The Stop hook, not screen output: a status line redraws forever. */
function finishedWhileAway(facts: SessionFacts): number | null {
  const ended = facts.turnEndedAt
  if (ended === null || facts.state !== 'idle' || facts.agent === null) return null
  return ended > (facts.lastAttendedAt ?? 0) ? ended : null
}

/** Asks core raises itself: a session waiting on you, and one that finished while you were away. */
export function coreAsksFrom(facts: readonly SessionFacts[], titles: IssueTitles): DeskAsk[] {
  return facts.flatMap((f) => {
    if (f.isClosed) return []
    if (f.state === 'awaiting-input') return [answerAsk(f, titles)]
    const endedAt = finishedWhileAway(f)
    return endedAt === null ? [] : [finishedAsk(f, endedAt, titles)]
  })
}

/** The facts line under a finished ask, from the branch's uncommitted change stats. */
export function finishedFacts(stats: ChangeStats | null): string[] {
  if (stats === null || stats.files === 0) return []
  const files = `${stats.files} ${stats.files === 1 ? 'file' : 'files'}`
  return [files, `+${stats.added} −${stats.removed}`]
}
