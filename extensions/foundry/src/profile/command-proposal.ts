import { z } from 'zod'
import { CHECK_NAMES } from '../verify/check-names.js'

// A command the scout read out of the repository and wants run as one of the checks.
// A proposal until it has exited 0 on the base branch.

export const CommandProposalSchema = z
  .object({
    check: z.enum(CHECK_NAMES),
    command: z.string().trim().min(1),
    /** `path:line` of the file the scout read the command from. */
    evidence: z.string().trim().min(1),
  })
  .strict()

export type CommandProposal = z.infer<typeof CommandProposalSchema>
