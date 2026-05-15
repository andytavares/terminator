import { z } from 'zod'
import { execFile as execFileCb } from 'child_process'
import { promisify } from 'util'
import { getStatus, getDiff, stageFiles, unstageFiles, commitChanges } from '../git/git-service.js'

const execFile = promisify(execFileCb)

type RegisterFn = (
  channel: string,
  handler: (payload: unknown) => Promise<unknown> | unknown
) => void

export function registerGitExtensionHandlers(register: RegisterFn): void {
  register('git:status', async (payload) => {
    const schema = z.object({
      path: z.string().min(1),
      maxFiles: z.number().int().positive().optional(),
    })
    const parsed = schema.safeParse(payload)
    if (!parsed.success) return { error: 'VALIDATION_ERROR' }
    try {
      return await getStatus(parsed.data.path, parsed.data.maxFiles ?? 500)
    } catch (e) {
      return { error: String(e) }
    }
  })

  register('git:diff-file', async (payload) => {
    const schema = z.object({
      repoRoot: z.string().min(1),
      path: z.string().min(1),
      staged: z.boolean(),
      isUntracked: z.boolean().optional(),
    })
    const parsed = schema.safeParse(payload)
    if (!parsed.success) return { error: 'VALIDATION_ERROR' }
    try {
      const diff = await getDiff(
        parsed.data.repoRoot,
        parsed.data.path,
        parsed.data.staged,
        parsed.data.isUntracked
      )
      return { diff }
    } catch (e) {
      return { error: String(e) }
    }
  })

  register('git:stage', async (payload) => {
    const schema = z.object({ repoRoot: z.string().min(1), paths: z.array(z.string()).min(1) })
    const parsed = schema.safeParse(payload)
    if (!parsed.success) return { error: 'VALIDATION_ERROR' }
    try {
      await stageFiles(parsed.data.repoRoot, parsed.data.paths)
      return { success: true as const }
    } catch (e) {
      return { error: String(e) }
    }
  })

  register('git:unstage', async (payload) => {
    const schema = z.object({ repoRoot: z.string().min(1), paths: z.array(z.string()).min(1) })
    const parsed = schema.safeParse(payload)
    if (!parsed.success) return { error: 'VALIDATION_ERROR' }
    try {
      await unstageFiles(parsed.data.repoRoot, parsed.data.paths)
      return { success: true as const }
    } catch (e) {
      return { error: String(e) }
    }
  })

  register('git:commit', async (payload) => {
    const schema = z.object({
      repoRoot: z.string().min(1),
      message: z.string(),
      signOff: z.boolean().optional(),
      noVerify: z.boolean().optional(),
    })
    const parsed = schema.safeParse(payload)
    if (!parsed.success) return { error: 'VALIDATION_ERROR' }
    if (!parsed.data.message.trim()) return { error: 'EMPTY_MESSAGE' }
    const result = await commitChanges(
      parsed.data.repoRoot,
      parsed.data.message,
      parsed.data.signOff ?? false,
      parsed.data.noVerify ?? false
    )
    return result
  })

  register('git:push', async (payload) => {
    const schema = z.object({ repoRoot: z.string().min(1) })
    const parsed = schema.safeParse(payload)
    if (!parsed.success) return { error: 'VALIDATION_ERROR' }
    try {
      await execFile('git', ['push'], {
        cwd: parsed.data.repoRoot,
        timeout: 60_000,
        env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
      })
      return { success: true }
    } catch (e) {
      const msg = String(e)
      if (msg.includes('has no upstream')) return { error: 'NO_UPSTREAM' }
      if (msg.includes('rejected')) return { error: 'REJECTED' }
      return { error: msg }
    }
  })

  register('git:pr-status', (_payload) => {
    return { pr: null }
  })

  register('git:pr-create', (_payload) => {
    return { error: 'NOT_IMPLEMENTED' }
  })
}
