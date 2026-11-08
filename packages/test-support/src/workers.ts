// How many unit workers a machine runs, by one rule in CI and locally (ADR 123): a core each, and
// no more than its memory holds. A worker with jsdom and coverage needs up to about 2.5 GB.

const MEMORY_PER_WORKER = 2.5 * 2 ** 30

export function unitWorkers({ cores, memory }: { cores: number; memory: number }): number {
  return Math.max(1, Math.min(cores, Math.floor(memory / MEMORY_PER_WORKER)))
}
