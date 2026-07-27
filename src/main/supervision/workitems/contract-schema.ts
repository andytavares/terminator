import { z } from 'zod'

// The published work-item contract (contracts/work-item.contract.md).
//
// Producers write these files into a directory the console owns and whose
// schema the console defines. The console never reads inside a producer's own
// directory and holds no knowledge of any producer's layout (FR-072).
//
// `session_id` is deliberately absent from lanes. The PRD put it there, which
// would require the console to write into producer state; it lives in
// console-owned lane bindings instead (FR-075). That is the single most
// important difference between this contract and the PRD's draft.

/** Bumped only for a removed or semantically changed required field. */
export const CURRENT_CONTRACT_VERSION = 1

const laneSchema = z.object({
  ord: z.number().int().positive(),
  repo: z.string().min(1),
  role: z.enum(['producer', 'consumer']),
  branch: z.string().min(1),
  task_ids: z.array(z.string()).default([]),
  blocks: z.array(z.number().int().positive()).default([]),
  blocked_by: z.array(z.number().int().positive()).default([]),
})

const gateSchema = z.object({
  ok: z.boolean(),
  at: z.string().optional(),
  open_questions: z.number().int().nonnegative().optional(),
  findings: z.number().int().nonnegative().optional(),
})

const workItemContractSchema = z.object({
  contract_version: z.number().int().positive(),
  id: z.string().min(1),
  source: z.enum(['linear', 'github', 'local']),
  source_url: z.string().optional(),
  title: z.string().min(1),
  created_at: z.string().min(1),
  phase: z.enum(['intake', 'specify', 'clarify', 'plan', 'tasks', 'implement', 'review', 'merged']),
  artifacts: z
    .object({
      spec: z.string().optional(),
      plan: z.string().optional(),
      tasks: z.string().optional(),
    })
    .prefault({}),
  gates: z.record(z.string(), gateSchema).prefault({}),
  contract: z
    .object({
      summary: z.string().optional(),
      shared_files: z.array(z.string()).default([]),
    })
    .optional(),
  // At least one lane, always. A single-lane item renders as one row with no
  // multi-repository ceremony (FR-089).
  lanes: z.array(laneSchema).min(1),
})

export type WorkItemContract = z.infer<typeof workItemContractSchema>
export type Lane = z.infer<typeof laneSchema>

export type ReadResult = { ok: true; item: WorkItemContract } | { ok: false; reason: string }

/**
 * Parses one contract file. Every failure is per-item and reported with a
 * reason — one malformed file must never affect another item or any surface
 * (FR-085).
 */
export function parseWorkItemContract(raw: string): ReadResult {
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    // Covers a torn write as well as genuine corruption. Re-read on the next
    // change event will pick it up once the producer finishes.
    return { ok: false, reason: 'not valid JSON (it may be a partial write)' }
  }

  if (typeof parsed !== 'object' || parsed === null) {
    return { ok: false, reason: 'not an object' }
  }

  const version = (parsed as Record<string, unknown>).contract_version
  if (typeof version !== 'number') {
    return { ok: false, reason: 'no contract version' }
  }
  if (version > CURRENT_CONTRACT_VERSION) {
    // Rejected outright rather than partially parsed: a newer major may have
    // changed the meaning of a field we think we understand.
    return {
      ok: false,
      reason: `published under contract version ${version}, this build understands ${CURRENT_CONTRACT_VERSION}`,
    }
  }

  const result = workItemContractSchema.safeParse(parsed)
  if (!result.success) {
    const issue = result.error.issues[0]
    return { ok: false, reason: `${issue.path.join('.') || 'contract'}: ${issue.message}` }
  }

  return { ok: true, item: result.data }
}
