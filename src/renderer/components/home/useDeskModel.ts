import { useMemo } from 'react'
import { useSessionFacts, useIssueTitles } from '../session/useSessionFacts'
import { useNow } from '../session/useNow'
import { useHomeFeedStore } from '../../stores/home-feed.store'
import { useChangeStatsStore } from '../../stores/change-stats.store'
import { useWorkThreads } from './useWorkThreads'
import { useDismissalsStore } from '../../home/dismissals'
import { coreAsksFrom, finishedFacts, type DeskAsk } from '../../home/core-asks'
import { orderAsks, type Dismissals } from '../../home/desk-order'
import { deskCounts, type DeskCounts } from '../../home/desk-summary'
import type { WorkThread } from '../../home/work-threads'
import type { ChangeStats } from '../../../shared/schemas/git.schema'
import type { SessionFacts } from '../../sidebar/session-facts'

export interface DeskState {
  /** Everything waiting on the operator, in the order to meet it. */
  asks: DeskAsk[]
  threads: WorkThread[]
  /** Threads that shipped too; a Focus item is done when its work shipped. */
  allThreads: WorkThread[]
  counts: DeskCounts
  snoozed: { count: number; until: number | null }
  doneToday: number
  now: number
}

/** A finished agent's line of change figures comes from its branch's uncommitted changes. */
function withFinishedFacts(
  ask: DeskAsk,
  facts: readonly SessionFacts[],
  stats: ReadonlyMap<string, { stats: ChangeStats | null }>
): DeskAsk {
  if (ask.kind !== 'finished') return ask
  const projectId = facts.find((f) => f.sessionId === ask.sessionId)?.projectId
  return { ...ask, facts: finishedFacts((projectId && stats.get(projectId)?.stats) || null) }
}

function snoozedSummary(hidden: readonly DeskAsk[], entries: Dismissals): DeskState['snoozed'] {
  const untils = hidden.flatMap((ask) => {
    const entry = entries[ask.id]
    return entry?.kind === 'snoozed' ? [entry.until] : []
  })
  return { count: untils.length, until: untils.length > 0 ? Math.min(...untils) : null }
}

/** What waits on the operator (core's asks and every extension's), who is working, and the counts. */
export function useDeskAsks(): DeskState {
  const now = useNow()
  const facts = useSessionFacts()
  const titles = useIssueTitles()
  const feedAsks = useHomeFeedStore((s) => s.asks)
  const entries = useDismissalsStore((s) => s.entries)
  const changeStats = useChangeStatsStore((s) => s.entries)
  const { threads, allThreads } = useWorkThreads()

  return useMemo(() => {
    const all: DeskAsk[] = [
      ...coreAsksFrom(facts, titles).map((ask) => withFinishedFacts(ask, facts, changeStats)),
      ...feedAsks,
    ]
    const asks = orderAsks(all, entries, now)
    const hidden = all.filter((ask) => !asks.includes(ask))
    return {
      asks,
      threads,
      allThreads,
      counts: deskCounts(asks, threads),
      snoozed: snoozedSummary(hidden, entries),
      doneToday: useDismissalsStore.getState().doneToday(now),
      now,
    }
  }, [facts, titles, feedAsks, entries, changeStats, threads, allThreads, now])
}
