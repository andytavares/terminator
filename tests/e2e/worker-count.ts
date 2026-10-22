import { availableParallelism } from 'node:os'

/**
 * Copies of the app that run at once, the same in CI and on a developer machine: one per three
 * cores. Each copy is an Electron app plus its agents, shells and git calls; on a 3-core CI runner
 * two copies only contend (run 36344425737: wall time equalled summed test time), and the default
 * of half the cores started eight or more apps in one second on a laptop that was also working.
 */
export function e2eWorkerCount(cores: number = availableParallelism()): number {
  return Math.max(1, Math.floor(cores / 3))
}
