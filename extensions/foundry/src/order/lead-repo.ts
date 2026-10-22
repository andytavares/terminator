import type { WorkOrder } from './schema.js'

type RepoRef = WorkOrder['context']['repos'][number]

/** The repository an order's profile, proof and checks belong to: its first lane. */
export function leadRepo(order: WorkOrder): RepoRef | undefined {
  return [...order.context.repos].sort((a, b) => a.lane - b.lane)[0]
}
