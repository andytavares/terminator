import type { ExecutorDeps } from '../../src/line/executor.js'

/**
 * The seams a host always supplies, answering as a host with nothing to
 * report would: no session to resume, nothing measured, nothing to commit.
 */
export function idleExecutorSeams(): Omit<
  ExecutorDeps,
  'run' | 'runCommand' | 'collect' | 'now' | 'sources' | 'onEvent'
> {
  return {
    sessionFor: () => undefined,
    record: async () => undefined,
    autonomy: 'escorted',
    rules: [],
    priorGates: [],
    raise: async () => undefined,
    endSession: async () => undefined,
    observe: async () => ({ elapsedMinutes: 0 }),
    persist: async () => undefined,
    // Never resolves: a poll that fires would read the budget mid-wave.
    wait: () => new Promise<void>(() => undefined),
    runStep: async () => null,
    runStepOnBase: async () => null,
    releaseBase: async () => undefined,
    reinstall: async () => null,
    observedChange: async () => ({ changedFiles: [], linesChanged: 0 }),
    commitNode: async () => ({ kind: 'committed' }),
  }
}
