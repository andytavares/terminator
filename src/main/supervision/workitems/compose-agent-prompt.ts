import type { WorkItemContract } from './contract-schema.js'

// FR-039. The mechanism that makes a work item actually reach the agent: its
// lane's assigned tasks and the paths of the specification and plan.
//
// Without this the board is a viewer. With it, approving a plan and starting a
// session are the same act from the agent's point of view.

export interface ComposeInput {
  readonly item: WorkItemContract | null
  readonly laneOrd: number | null
  /** Free-text instruction for ad-hoc work, or extra steer alongside a work item. */
  readonly instruction?: string
}

export function composeAgentPrompt(input: ComposeInput): string {
  const { item, laneOrd, instruction } = input

  // Ad-hoc work: no work item bound, so there is nothing to compose from and
  // the instruction stands alone (FR-081).
  if (item === null || laneOrd === null) {
    return (instruction ?? '').trim()
  }

  const lane = item.lanes.find((candidate) => candidate.ord === laneOrd)
  if (lane === undefined) return (instruction ?? '').trim()

  const parts: string[] = [`Work item ${item.id}: ${item.title}`, `Repository: ${lane.repo}`]

  if (item.artifacts.spec !== undefined) parts.push(`Specification: ${item.artifacts.spec}`)
  if (item.artifacts.plan !== undefined) parts.push(`Plan: ${item.artifacts.plan}`)
  if (item.artifacts.tasks !== undefined) parts.push(`Tasks: ${item.artifacts.tasks}`)

  if (lane.task_ids.length > 0) {
    parts.push(`Implement exactly these tasks, and no others: ${lane.task_ids.join(', ')}`)
  }

  const sharedFiles = item.contract?.shared_files ?? []
  if (sharedFiles.length > 0) {
    // Named explicitly because a change here ripples into every other lane.
    parts.push(
      `Shared contract files — changing one affects other repositories: ${sharedFiles.join(', ')}`
    )
    if (item.contract?.summary !== undefined) parts.push(`Contract: ${item.contract.summary}`)
  }

  if (lane.role === 'consumer' && lane.blocked_by.length > 0) {
    parts.push(
      `This lane consumes a contract produced by lane ${lane.blocked_by.join(', ')} — do not change the shared contract yourself.`
    )
  }

  if (instruction !== undefined && instruction.trim() !== '') parts.push(instruction.trim())

  return parts.join('\n')
}
