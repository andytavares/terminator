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
  noVerify: z.boolean().optional(),
})

/** The Git settings the channels read on every call, so a change applies to the next one. */
export interface GitSettings {
  /** Whether a commit in `repoRoot` adds a Signed-off-by trailer (workspace-scoped). */
  signOff(repoRoot: string): boolean
  maxDisplayedFiles(): number
}

async function commitCollectingOutput(payload: z.infer<typeof CommitPayload>, signOff: boolean) {
  const { repoRoot, message, noVerify } = payload
  if (!message.trim()) return { error: 'EMPTY_MESSAGE' }
  commitOutputBuffer.set(repoRoot, [])
  const appendCommitLine = (line: string) => commitOutputBuffer.get(repoRoot)?.push(line)
  const result = await commitChanges(repoRoot, message, {
    signOff,
    noVerify: noVerify ?? false,
    onOutput: appendCommitLine,
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

/** The channels whose answer a setting decides. */
function settingChannels(settings: GitSettings): ChannelSpec[] {
  return [
    defineChannel({
      channel: 'git:status',
      schema: z.object({ path: RepoRoot }),
      invalid: VALIDATION_ERROR,
      run: ({ path }) => getStatus(path, settings.maxDisplayedFiles()),
      onError: errorEnvelope,
    }),
    defineChannel({
      channel: 'git:commit',
      schema: CommitPayload,
      invalid: VALIDATION_ERROR,
      run: (payload) => commitCollectingOutput(payload, settings.signOff(payload.repoRoot)),
    }),
  ]
}

const GIT_CHANNELS: ChannelSpec[] = [
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
]

export function registerGitExtensionHandlers(registerRaw: RegisterFn, settings: GitSettings): void {
  const register = withTiming(registerRaw)
  for (const spec of [...settingChannels(settings), ...GIT_CHANNELS]) register(spec)
  registerMergeFlowHandlers(register)
}
