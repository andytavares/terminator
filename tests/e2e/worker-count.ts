import { availableParallelism } from 'node:os'

/** Apps run at once, the same rule in CI and locally: one per three cores. Two on a 3-core runner
 * only contended (run 36344425737), and half the cores started 8+ apps at once on a laptop. */
export function e2eWorkerCount(cores: number = availableParallelism()): number {
  return Math.max(1, Math.floor(cores / 3))
}
