import type { WorkOrder } from '../order/schema.js'

/** The commands the toolchain probe found, trimmed: the ones a role may run as they are. */
export function probedCommands(order: WorkOrder): string[] {
  return Object.values(order.context.toolchain)
    .filter((found) => found !== null)
    .map((found) => found.command.trim())
}
