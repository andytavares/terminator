import { z } from 'zod'
import { readFile } from 'fs/promises'
import { writeFileAtomic } from '../utils/write-atomic.js'
import { isAbsolute } from 'path'
import { namedStore } from '../storage-directory.js'
import { defineChannel, type ChannelSpec } from '@terminator/extension-sdk'
import {
  buildConflictSession,
  readConflictBlocks,
  listConflictedFiles,
} from '../git/conflict-reader.js'
import { ResolutionStrategySchema } from '../schemas/merge-flow.schema.js'
import { runGit } from '../shell/run-git.js'
import { RepoRoot } from './repo-root.js'
import { VALIDATION_ERROR, errorEnvelope, type RegisterFn } from './register.js'

/** A conflicted file of the checkout, read whole. */
interface BlockFile {
  fullPath: string
  filePath: string
  index: number
  content: string
}

// electron-store's default name, kept so stored sessions survive the move.
const configStore = () => namedStore('config')

const GIT_TIMEOUT = 10_000

function git(args: string[], cwd: string): Promise<string> {
  return runGit(cwd, args, { timeoutMs: GIT_TIMEOUT })
}

function sessionKey(repoRoot: string): string {
  return `mergeflow:session:${repoRoot}`
}

const RepoRootPayload = z.object({ repoRoot: RepoRoot })

// "relative/path/file.ts#index". The path is joined onto repoRoot and written,
// so it must stay inside the repository: relative, and no ".." segment.
const BlockId = z
  .string()
  .regex(/^[^#]+#\d+$/, 'expected path#index')
  .refine((id) => {
    const path = id.slice(0, id.lastIndexOf('#'))
    return !isAbsolute(path) && !path.split(/[\\/]/).includes('..')
  }, 'the file must be inside the repository')

const ResolvePayload = z.object({
  repoRoot: RepoRoot,
  blockId: BlockId,
  resolvedText: z.string(),
  strategy: ResolutionStrategySchema,
  currentResolvedText: z.string().optional(),
  originalConflictText: z.string().optional(),
})

const UndoPayload = z.object({
  repoRoot: RepoRoot,
  blockId: BlockId,
  resolvedText: z.string(),
  originalConflictText: z.string().min(1),
})

const PreparePayload = z.object({
  repoRoot: RepoRoot,
  worktreePath: z.string().min(1),
  headRefName: z.string().min(1),
  baseRefName: z.string().min(1),
})

/** Reads the file a block id names, `<path relative to the repo>#<block index>`. */
async function readBlockFile(repoRoot: string, blockId: string): Promise<BlockFile> {
  const hashIdx = blockId.lastIndexOf('#')
  const filePath = blockId.slice(0, hashIdx)
  const fullPath = `${repoRoot}/${filePath}`
  const index = parseInt(blockId.slice(hashIdx + 1), 10)
  return { fullPath, filePath, index, content: await readFile(fullPath, 'utf-8') }
}

/** The text a resolution replaces: the block's original conflict text (findable however many
 *  blocks are resolved), else its previous resolution, else (sessions from before the text was
 *  kept) the block at its index. Null when no markers remain for it. */
function textToReplace(file: BlockFile, payload: z.infer<typeof ResolvePayload>): string | null {
  const { originalConflictText, currentResolvedText } = payload
  if (originalConflictText && file.content.includes(originalConflictText))
    return originalConflictText
  if (currentResolvedText && file.content.includes(currentResolvedText)) return currentResolvedText
  const target = readConflictBlocks(file.filePath, file.content)[file.index]
  return target?.originalConflictText ?? null
}

/** A block with no markers left was consumed by an earlier resolution; that still answers success,
 *  so the session can finish navigating, and the file stays as it is. */
async function resolveConflictBlock(payload: z.infer<typeof ResolvePayload>) {
  const file = await readBlockFile(payload.repoRoot, payload.blockId)
  const from = textToReplace(file, payload)
  if (from !== null) {
    await writeFileAtomic(file.fullPath, file.content.replace(from, payload.resolvedText))
  }
  return { success: true }
}

async function undoBlockResolve(payload: z.infer<typeof UndoPayload>) {
  const file = await readBlockFile(payload.repoRoot, payload.blockId)
  if (!file.content.includes(payload.resolvedText)) {
    return { error: 'Resolved text not found in file — file may have changed since resolution.' }
  }
  const updated = file.content.replace(payload.resolvedText, payload.originalConflictText)
  await writeFileAtomic(file.fullPath, updated)
  return { success: true }
}

/** Pushes to the branch's upstream, named explicitly: the local branch (conflict-resolve/foo)
 *  differs from the remote one (origin/foo). Best-effort: a local merge may have no upstream. */
async function pushToUpstream(repoRoot: string): Promise<string | undefined> {
  try {
    const upstream = await git(
      ['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{u}'],
      repoRoot
    )
    // "origin/test/conflict-theirs"
    const slashIdx = upstream.indexOf('/')
    const remoteName = slashIdx === -1 ? 'origin' : upstream.slice(0, slashIdx)
    const remoteBranch = upstream.slice(slashIdx + 1)
    await git(
      ['push', '--force-with-lease', remoteName, `HEAD:refs/heads/${remoteBranch}`],
      repoRoot
    )
    return undefined
  } catch (pushErr) {
    return String(pushErr)
  }
}

async function commitResolvedMerge(
  repoRoot: string,
  resolvedFilePaths: string[],
  commitMessage: string
) {
  await git(['add', '--', ...resolvedFilePaths], repoRoot)
  const out = await git(['commit', '-m', commitMessage], repoRoot)
  // "[main abc1234] message"
  const commitHash = out.match(/\[[\w/]+\s+([a-f0-9]+)\]/)?.[1] ?? 'unknown'
  return { commitHash, pushError: await pushToUpstream(repoRoot) }
}

/** The first of `refs` missing locally. Nothing is fetched: a fetch changes shared git state and can
 *  collide with other work in the repo; the caller's status polling keeps the refs current. */
async function missingRef(repoRoot: string, refs: string[]): Promise<string | undefined> {
  const present = await Promise.all(
    refs.map((ref) =>
      git(['rev-parse', '--verify', ref], repoRoot)
        .then(() => true)
        .catch(() => false)
    )
  )
  return refs.find((_, i) => !present[i])
}

/** Merges the base into the worktree; a failure with no conflict markers removes the worktree. */
async function mergeBaseInto(payload: z.infer<typeof PreparePayload>, baseRemote: string) {
  try {
    await git(['merge', baseRemote], payload.worktreePath)
    return { hasConflicts: false }
  } catch {
    const conflicted = await listConflictedFiles(payload.worktreePath).catch(() => [])
    if (conflicted.length > 0) return { hasConflicts: true }
    // Merge failed for a non-conflict reason (e.g. unrelated histories)
    await removeMergeWorktree(payload)
    return { error: 'Merge failed with no conflict markers — check the branch state.' }
  }
}

function removeMergeWorktree(payload: z.infer<typeof PreparePayload>): Promise<unknown> {
  const args = ['worktree', 'remove', '--force', payload.worktreePath]
  return git(args, payload.repoRoot).catch(() => {})
}

/** A worktree of the PR's remote head on a fresh local branch, conflict-resolve/<head>, so it is
 *  never "already checked out" elsewhere, then the base merged in to produce conflict markers. */
async function prepareWorktreeForPr(payload: z.infer<typeof PreparePayload>) {
  const headRemote = `origin/${payload.headRefName}`
  const baseRemote = `origin/${payload.baseRefName}`
  try {
    const missing = await missingRef(payload.repoRoot, [headRemote, baseRemote])
    if (missing) {
      return {
        error: `Remote ref '${missing}' not found locally. Run git fetch first, then try again.`,
      }
    }
    const localBranch = `conflict-resolve/${payload.headRefName.replace(/\//g, '-')}`
    const args = ['worktree', 'add', '-B', localBranch, payload.worktreePath, headRemote]
    await git(args, payload.repoRoot)
    return await mergeBaseInto(payload, baseRemote)
  } catch (e) {
    await removeMergeWorktree(payload)
    return errorEnvelope(e)
  }
}

/** The stored session, while conflicts remain and it has some; otherwise it is dropped. */
async function restoreMergeSession(repoRoot: string) {
  const sessions = await configStore()
  const stored = sessions.get(sessionKey(repoRoot)) as { totalConflicts?: number } | undefined
  if (!stored) return { session: null }
  const conflicted = await listConflictedFiles(repoRoot).catch(() => [])
  // An empty session is stale, e.g. from a broken Start Over.
  if (conflicted.length === 0 || !stored.totalConflicts) {
    sessions.delete(sessionKey(repoRoot))
    return { session: null }
  }
  return { session: stored }
}

/** Restores every file's conflict markers and clears the persisted session. */
async function resetMergeSession(repoRoot: string, files: Array<{ filePath: string }>) {
  for (const file of files) {
    // --conflict=merge re-creates the markers whether or not a block's resolvedText was saved.
    await git(['checkout', '--conflict=merge', '--', file.filePath], repoRoot)
  }
  const sessions = await configStore()
  sessions.delete(sessionKey(repoRoot))
  return { success: true }
}

function resolutionChannels(): ChannelSpec[] {
  return [
    defineChannel({
      channel: 'git:conflicts-list',
      schema: RepoRootPayload,
      invalid: VALIDATION_ERROR,
      run: ({ repoRoot }) => buildConflictSession(repoRoot),
      onError: errorEnvelope,
    }),
    defineChannel({
      channel: 'git:resolve-conflict',
      schema: ResolvePayload,
      invalid: VALIDATION_ERROR,
      run: resolveConflictBlock,
      onError: errorEnvelope,
    }),
    defineChannel({
      channel: 'git:undo-resolve',
      schema: UndoPayload,
      invalid: VALIDATION_ERROR,
      run: undoBlockResolve,
      onError: errorEnvelope,
    }),
  ]
}

function branchChannels(): ChannelSpec[] {
  return [
    defineChannel({
      channel: 'git:merge-commit',
      schema: z.object({
        repoRoot: RepoRoot,
        resolvedFilePaths: z.array(z.string().min(1)),
        commitMessage: z.string().min(1),
      }),
      invalid: VALIDATION_ERROR,
      run: (p) => commitResolvedMerge(p.repoRoot, p.resolvedFilePaths, p.commitMessage),
      onError: errorEnvelope,
    }),
    defineChannel({
      channel: 'git:prepare-pr-worktree',
      schema: PreparePayload,
      invalid: VALIDATION_ERROR,
      run: prepareWorktreeForPr,
    }),
  ]
}

function mergeSessionChannels(): ChannelSpec[] {
  return [
    defineChannel({
      channel: 'git:session-restore',
      schema: RepoRootPayload,
      invalid: VALIDATION_ERROR,
      run: ({ repoRoot }) => restoreMergeSession(repoRoot),
      onError: errorEnvelope,
    }),
    defineChannel({
      channel: 'git:session-persist',
      schema: z.object({ repoRoot: RepoRoot, session: z.unknown() }),
      invalid: VALIDATION_ERROR,
      run: async ({ repoRoot, session }) => {
        const sessions = await configStore()
        sessions.set(sessionKey(repoRoot), session)
        return { success: true }
      },
      onError: errorEnvelope,
    }),
  ]
}

function sessionEndChannels(): ChannelSpec[] {
  return [
    // Never fails: clearing a session that cannot be cleared still answers success.
    defineChannel({
      channel: 'git:session-clear',
      schema: RepoRootPayload,
      invalid: { success: true },
      run: async ({ repoRoot }) => {
        const sessions = await configStore()
        sessions.delete(sessionKey(repoRoot))
        return { success: true }
      },
      onError: () => ({ success: true }),
    }),
    defineChannel({
      channel: 'git:session-reset',
      schema: z.object({ repoRoot: RepoRoot, files: z.array(z.object({ filePath: z.string() })) }),
      invalid: VALIDATION_ERROR,
      run: ({ repoRoot, files }) => resetMergeSession(repoRoot, files),
      onError: errorEnvelope,
    }),
  ]
}

export function registerMergeFlowHandlers(register: RegisterFn): void {
  const channels = [
    ...resolutionChannels(),
    ...branchChannels(),
    ...mergeSessionChannels(),
    ...sessionEndChannels(),
  ]
  for (const spec of channels) register(spec)
}
