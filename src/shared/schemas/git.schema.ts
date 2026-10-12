import { z } from 'zod'

/** Uncommitted change volume for one working tree, staged and unstaged. */
export const ChangeStatsSchema = z.object({
  added: z.number().int().nonnegative(),
  removed: z.number().int().nonnegative(),
  files: z.number().int().nonnegative(),
})

export type ChangeStats = z.infer<typeof ChangeStatsSchema>
