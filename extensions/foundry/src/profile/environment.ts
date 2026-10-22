import type { WorkOrder } from '../order/schema.js'
import { defaultHintsDir } from './hints.js'
import { resolveProfile, type ResolvedProfile } from './resolve.js'
import { readProfile } from './store.js'
import { leadRepo } from '../order/lead-repo.js'

type Environment = WorkOrder['context']['environment']

/** The part of a resolved profile an order carries: commands only, no provenance. */
export function environmentOf(resolved: ResolvedProfile): Environment {
  return {
    resolved: true,
    prepare: resolved.prepare?.command ?? null,
    share: [...resolved.share],
    pictures: resolved.pictures?.command ?? null,
    paths: { ...resolved.paths },
    additional: resolved.additional.map(({ name, command, rung }) => ({ name, command, rung })),
  }
}

// An order written before profiles parses with an empty environment, which would lend
// its lanes nothing and prepare nothing; a seeded order is returned as it is.
export async function withProfileEnvironment(root: string, order: WorkOrder): Promise<WorkOrder> {
  if (order.context.environment.resolved) return order
  const repoPath = leadRepo(order)?.path ?? ''
  const stored = await readProfile(root, repoPath)
  const resolved = resolveProfile({ repoPath, hintsDir: defaultHintsDir(), stored })
  return { ...order, context: { ...order.context, environment: environmentOf(resolved) } }
}
