import { z } from 'zod'
import { defineChannel } from '@terminator/extension-sdk'
import {
  getStatus,
  getDiff,
  stageFiles,
  unstageFiles,
  commitChanges,
  pushBranch,
} from '../git/git-service.js'
import { registerMergeFlowHandlers } from './merge-flow.ipc.js'
import { RepoRoot } from './repo-root.js'
import { withTiming, VALIDATION_ERROR, errorEnvelope, type RegisterFn } from './register.js'

// Lines emitted by the running commit process, keyed by repoRoot.
// Cleared when commit finishes; consumed incrementally by commitOutputPoll.
const commitOutputBuffer = new Map<string, string[]>()

const StagePayload = z.object({ repoRoot: RepoRoot, paths: z.array(z.string()).min(1) })
const RepoRootPayload = z.object({ repoRoot: RepoRoot })

export function registerGitExtensionHandlers(registerRaw: RegisterFn): void {
  const register = withTiming(registerRaw)
  register(
    defineChannel({
      channel: 'git:status',
      schema: z.object({ path: RepoRoot, maxFiles: z.number().int().positive().optional() }),
      invalid: VALIDATION_ERROR,
      run: ({ path, maxFiles }) => getStatus(path, maxFiles ?? 500),
      onError: errorEnvelope,
    })
  )

  register(
    defineChannel({
      channel: 'git:diff-file',
      schema: z.object({
        repoRoot: RepoRoot,
        path: z.string().min(1),
        staged: z.boolean(),
        isUntracked: z.boolean().optional(),
      }),
      invalid: VALIDATION_ERROR,
      run: async ({ repoRoot, path, staged, isUntracked }) => ({
        diff: await getDiff(repoRoot, path, staged, isUntracked),
      }),
      onError: errorEnvelope,
    })
  )

  register(
    defineChannel({
      channel: 'git:stage',
      schema: StagePayload,
      invalid: VALIDATION_ERROR,
      run: async ({ repoRoot, paths }) => {
        await stageFiles(repoRoot, paths)
        return { success: true as const }
      },
      onError: errorEnvelope,
    })
  )

  register(
    defineChannel({
      channel: 'git:unstage',
      schema: StagePayload,
      invalid: VALIDATION_ERROR,
      run: async ({ repoRoot, paths }) => {
        await unstageFiles(repoRoot, paths)
        return { success: true as const }
      },
      onError: errorEnvelope,
    })
  )

  register(
    defineChannel({
      channel: 'git:commit',
      schema: z.object({
        repoRoot: RepoRoot,
        message: z.string(),
        signOff: z.boolean().optional(),
        noVerify: z.boolean().optional(),
      }),
      invalid: VALIDATION_ERROR,
      run: async ({ repoRoot, message, signOff, noVerify }) => {
        if (!message.trim()) return { error: 'EMPTY_MESSAGE' }
        commitOutputBuffer.set(repoRoot, [])
        const result = await commitChanges(
          repoRoot,
          message,
          signOff ?? false,
          noVerify ?? false,
          (line) => commitOutputBuffer.get(repoRoot)?.push(line)
        )
        commitOutputBuffer.delete(repoRoot)
        return result
      },
    })
  )

  register(
    defineChannel({
      channel: 'git:commit-output-poll',
      schema: RepoRootPayload,
      invalid: { lines: [] as string[] },
      run: ({ repoRoot }) => {
        const buf = commitOutputBuffer.get(repoRoot)
        if (!buf) return { lines: [] as string[] }
        const lines = [...buf]
        buf.length = 0 // consume in-place so next poll gets only new lines
        return { lines }
      },
    })
  )

  register(
    defineChannel({
      channel: 'git:push',
      schema: RepoRootPayload,
      invalid: VALIDATION_ERROR,
      run: ({ repoRoot }) => pushBranch(repoRoot),
    })
  )

  register(
    defineChannel({
      channel: 'git:pr-status',
      schema: RepoRootPayload,
      invalid: VALIDATION_ERROR,
      run: () => ({ pr: null }),
    })
  )

  registerMergeFlowHandlers(register)
}
