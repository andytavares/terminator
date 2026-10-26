import type { HomeAsk } from '../../shared/schemas/home-feed.schema'
import type { WorkThread } from './work-threads'

export interface DeskCounts {
  yourMove: number
  agentsWorking: number
  waitingOnOthers: number
  failingChecks: number
}

/** The numbers in the Desk's header line; the view leaves out any that is zero. */
export function deskCounts(asks: readonly HomeAsk[], threads: readonly WorkThread[]): DeskCounts {
  const live = threads.filter((t) => !t.archived)
  return {
    yourMove: asks.length,
    agentsWorking: threads.reduce(
      (sum, t) => sum + t.sessions.filter((s) => s.state === 'working').length,
      0
    ),
    waitingOnOthers: live.filter((t) => t.state === 'waiting').length,
    failingChecks: threads
      .flatMap((t) => t.facets)
      .filter((f) => f.kind === 'pull-request' && f.tone === 'bad').length,
  }
}
