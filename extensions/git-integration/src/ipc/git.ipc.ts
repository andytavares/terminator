import { z } from 'zod'
import {
  getStatus,
  getDiff,
  stageFiles,
  unstageFiles,
  commitChanges,
  pushBranch,
} from '../git/git-service.js'
import { registerMergeFlowHandlers } from './merge-flow.ipc.js'

type RegisterFn = (
  channel: string,
  handler: (payload: unknown) => Promise<unknown> | unknown
) => void

// Lines emitted by the running commit process, keyed by repoRoot.
// Cleared when commit finishes; consumed incrementally by commitOutputPoll.
const commitOutputBuffer = new Map<string, string[]>()

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
    const { repoRoot } = parsed.data
    commitOutputBuffer.set(repoRoot, [])
    const result = await commitChanges(
      repoRoot,
      parsed.data.message,
      parsed.data.signOff ?? false,
      parsed.data.noVerify ?? false,
      (line) => {
        const buf = commitOutputBuffer.get(repoRoot)
        if (buf) buf.push(line)
      }
    )
    commitOutputBuffer.delete(repoRoot)
    return result
  })

  register('git:commit-output-poll', (payload) => {
    const schema = z.object({ repoRoot: z.string().min(1) })
    const parsed = schema.safeParse(payload)
    if (!parsed.success) return { lines: [] as string[] }
    const buf = commitOutputBuffer.get(parsed.data.repoRoot)
    if (!buf) return { lines: [] as string[] }
    const lines = [...buf]
    buf.length = 0 // consume in-place so next poll gets only new lines
    return { lines }
  })

  register('git:push', async (payload) => {
    const schema = z.object({ repoRoot: z.string().min(1) })
    const parsed = schema.safeParse(payload)
    if (!parsed.success) return { error: 'VALIDATION_ERROR' }
    return pushBranch(parsed.data.repoRoot)
  })

  register('git:pr-status', (_payload) => {
    return { pr: null }
  })

  register('git:pr-create', (_payload) => {
    return { error: 'NOT_IMPLEMENTED' }
  })

  registerMergeFlowHandlers(register)
}
