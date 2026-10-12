import { z } from 'zod'
import { defineChannel, type ChannelSpec } from '@terminator/extension-sdk'
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

const CommitPayload = z.object({
  repoRoot: RepoRoot,
  message: z.string(),
  signOff: z.boolean().optional(),
  noVerify: z.boolean().optional(),
})

async function commitCollectingOutput(payload: z.infer<typeof CommitPayload>) {
  const { repoRoot, message, signOff, noVerify } = payload
  if (!message.trim()) return { error: 'EMPTY_MESSAGE' }
  commitOutputBuffer.set(repoRoot, [])
  const onOutput = (line: string) => commitOutputBuffer.get(repoRoot)?.push(line)
  const result = await commitChanges(repoRoot, message, {
    signOff: signOff ?? false,
    noVerify: noVerify ?? false,
    onOutput,
  })
  commitOutputBuffer.delete(repoRoot)
  return result
}

function takeCommitOutput({ repoRoot }: z.infer<typeof RepoRootPayload>) {
  const buf = commitOutputBuffer.get(repoRoot)
  if (!buf) return { lines: [] as string[] }
  const lines = [...buf]
  buf.length = 0 // consume in-place so next poll gets only new lines
  return { lines }
}

const GIT_CHANNELS: ChannelSpec[] = [
  defineChannel({
    channel: 'git:status',
    schema: z.object({ path: RepoRoot, maxFiles: z.number().int().positive().optional() }),
    invalid: VALIDATION_ERROR,
    run: ({ path, maxFiles }) => getStatus(path, maxFiles ?? 500),
    onError: errorEnvelope,
  }),
  defineChannel({
    channel: 'git:diff-file',
    schema: z.object({
      repoRoot: RepoRoot,
      path: z.string().min(1),
      staged: z.boolean(),
      isUntracked: z.boolean().optional(),
    }),
    invalid: VALIDATION_ERROR,
    run: async (payload) => {
      const { staged, isUntracked } = payload
      return { diff: await getDiff(payload.repoRoot, payload.path, { staged, isUntracked }) }
    },
    onError: errorEnvelope,
  }),
  defineChannel({
    channel: 'git:stage',
    schema: StagePayload,
    invalid: VALIDATION_ERROR,
    run: async ({ repoRoot, paths }) => {
      await stageFiles(repoRoot, paths)
      return { success: true as const }
    },
    onError: errorEnvelope,
  }),
  defineChannel({
    channel: 'git:unstage',
    schema: StagePayload,
    invalid: VALIDATION_ERROR,
    run: async ({ repoRoot, paths }) => {
      await unstageFiles(repoRoot, paths)
      return { success: true as const }
    },
    onError: errorEnvelope,
  }),
  defineChannel({
    channel: 'git:commit',
    schema: CommitPayload,
    invalid: VALIDATION_ERROR,
    run: commitCollectingOutput,
  }),
  defineChannel({
    channel: 'git:commit-output-poll',
    schema: RepoRootPayload,
    invalid: { lines: [] as string[] },
    run: takeCommitOutput,
  }),
  defineChannel({
    channel: 'git:push',
    schema: RepoRootPayload,
    invalid: VALIDATION_ERROR,
    run: ({ repoRoot }) => pushBranch(repoRoot),
  }),
  defineChannel({
    channel: 'git:pr-status',
    schema: RepoRootPayload,
    invalid: VALIDATION_ERROR,
    run: () => ({ pr: null }),
  }),
]

export function registerGitExtensionHandlers(registerRaw: RegisterFn): void {
  const register = withTiming(registerRaw)
  for (const spec of GIT_CHANNELS) register(spec)
  registerMergeFlowHandlers(register)
}
