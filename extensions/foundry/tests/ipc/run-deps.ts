import type { RunDeps } from '../../src/ipc/run-channels.js'

/** The seams a host always supplies, answering as a host with nothing running would. */
export function idleRunSeams(): Omit<RunDeps, 'store' | 'dataRoot' | 'sources' | 'now'> {
  return {
    execute: async () => undefined,
    isLive: () => false,
    executing: () => false,
    gatesFor: async () => [],
    asksFor: () => 0,
    stallsFor: () => 0,
    strandedFor: () => 0,
    strandedSessions: () => [],
    activityFor: () => [],
    queueEntries: async () => [],
    recordUse: () => undefined,
  }
}
