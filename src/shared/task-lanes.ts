import type { TaskLane } from './schemas/tasks.schema'

/** Whether two lanes are the same repo and branch. */
export const sameLane = (a: TaskLane, b: TaskLane): boolean =>
  a.repoRoot === b.repoRoot && a.branch === b.branch
