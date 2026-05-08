import { z } from 'zod'

export const ShellExecOptionsSchema = z.object({
  command: z.enum(['git', 'gh']),
  args: z.array(z.string()),
  cwd: z.string().min(1),
  timeoutMs: z.number().int().positive().default(10000),
})

export const ShellResultSchema = z.object({
  exitCode: z.number().int(),
  stdout: z.string(),
  stderr: z.string(),
  timedOut: z.boolean(),
})

export type ShellExecOptions = z.infer<typeof ShellExecOptionsSchema>
export type ShellResult = z.infer<typeof ShellResultSchema>
