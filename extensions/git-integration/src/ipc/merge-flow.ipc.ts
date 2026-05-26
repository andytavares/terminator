import { z } from 'zod'
import { execFile as execFileCb } from 'child_process'
import { promisify } from 'util'
import { readFile, writeFile } from 'fs/promises'
import Store from 'electron-store'
import {
  buildConflictSession,
  readConflictBlocks,
  listConflictedFiles,
} from '../git/conflict-reader.js'
import { ResolutionStrategySchema } from '../schemas/merge-flow.schema.js'

const execFile = promisify(execFileCb)
const store = new Store()

const GIT_TIMEOUT = 10_000

type RegisterFn = (
  channel: string,
  handler: (payload: unknown) => Promise<unknown> | unknown
) => void

async function git(args: string[], cwd: string): Promise<string> {
  const { stdout } = await execFile('git', args, {
    cwd,
    timeout: GIT_TIMEOUT,
    env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
  })
  return stdout.trim()
}

function sessionKey(repoRoot: string): string {
  return `mergeflow:session:${repoRoot}`
}

export function registerMergeFlowHandlers(register: RegisterFn): void {
  // git:conflicts-list
  register('git:conflicts-list', async (payload) => {
    const schema = z.object({ repoRoot: z.string().min(1) })
    const parsed = schema.safeParse(payload)
    if (!parsed.success) return { error: 'VALIDATION_ERROR' }
    try {
      return await buildConflictSession(parsed.data.repoRoot)
    } catch (e) {
      return { error: String(e) }
    }
  })

  // git:conflict-blocks
  register('git:conflict-blocks', async (payload) => {
    const schema = z.object({
      repoRoot: z.string().min(1),
      filePath: z.string().min(1),
    })
    const parsed = schema.safeParse(payload)
    if (!parsed.success) return { error: 'VALIDATION_ERROR' }
    try {
      const { repoRoot, filePath } = parsed.data
      const [baseContent, oursContent, theirsContent, workingTree] = await Promise.all([
        git(['show', `:1:${filePath}`], repoRoot).catch(() => ''),
        git(['show', `:2:${filePath}`], repoRoot).catch(() => ''),
        git(['show', `:3:${filePath}`], repoRoot).catch(() => ''),
        readFile(`${repoRoot}/${filePath}`, 'utf-8').catch(() => ''),
      ])
      const blocks = readConflictBlocks(
        filePath,
        workingTree,
        baseContent,
        oursContent,
        theirsContent
      )
      return { blocks }
    } catch (e) {
      return { error: String(e) }
    }
  })

  // git:resolve-conflict
  register('git:resolve-conflict', async (payload) => {
    const schema = z.object({
      repoRoot: z.string().min(1),
      blockId: z.string().min(1),
      resolvedText: z.string(),
      strategy: ResolutionStrategySchema,
      currentResolvedText: z.string().optional(),
      originalConflictText: z.string().optional(),
    })
    const parsed = schema.safeParse(payload)
    if (!parsed.success) return { error: 'VALIDATION_ERROR' }
    try {
      const { repoRoot, blockId, resolvedText, currentResolvedText, originalConflictText } =
        parsed.data
      // blockId format: "relative/path/file.ts#index"
      const hashIdx = blockId.lastIndexOf('#')
      const filePath = blockId.slice(0, hashIdx)
      const fullPath = `${repoRoot}/${filePath}`
      const content = await readFile(fullPath, 'utf-8')

      // 1. Primary: match by original conflict text — stable regardless of how many
      //    blocks have already been resolved (block indices shift as markers are removed)
      if (originalConflictText && content.includes(originalConflictText)) {
        const updated = content.replace(originalConflictText, resolvedText)
        await writeFile(fullPath, updated, 'utf-8')
        return { success: true }
      }

      // 2. Block already resolved — replace the previously written resolved text
      if (currentResolvedText && content.includes(currentResolvedText)) {
        const updated = content.replace(currentResolvedText, resolvedText)
        await writeFile(fullPath, updated, 'utf-8')
        return { success: true }
      }

      // 3. Fallback: index-based lookup (for sessions started before this fix)
      const blocks = readConflictBlocks(filePath, content, '', '', '')
      const blockIndex = parseInt(blockId.slice(hashIdx + 1), 10)
      const target = blocks[blockIndex]
      if (target) {
        const updated = content.replace(target.originalConflictText, resolvedText)
        await writeFile(fullPath, updated, 'utf-8')
        return { success: true }
      }

      // 4. No conflict markers remain for this block — it was already consumed by a
      //    previous resolution (possibly incorrect). Treat as a soft success so the
      //    session can finish navigating. The file content stays as-is.
      return { success: true }

      return { error: `Block ${blockId} not found in file` }
    } catch (e) {
      return { error: String(e) }
    }
  })

  // git:undo-resolve
  register('git:undo-resolve', async (payload) => {
    const schema = z.object({
      repoRoot: z.string().min(1),
      blockId: z.string().min(1),
      resolvedText: z.string(),
      originalConflictText: z.string().min(1),
    })
    const parsed = schema.safeParse(payload)
    if (!parsed.success) return { error: 'VALIDATION_ERROR' }
    try {
      const { repoRoot, blockId, resolvedText, originalConflictText } = parsed.data
      const hashIdx = blockId.lastIndexOf('#')
      const filePath = blockId.slice(0, hashIdx)
      const fullPath = `${repoRoot}/${filePath}`
      const content = await readFile(fullPath, 'utf-8')
      if (!content.includes(resolvedText)) {
        return {
          error: 'Resolved text not found in file — file may have changed since resolution.',
        }
      }
      const updated = content.replace(resolvedText, originalConflictText)
      await writeFile(fullPath, updated, 'utf-8')
      return { success: true }
    } catch (e) {
      return { error: String(e) }
    }
  })

  // git:merge-commit
  register('git:merge-commit', async (payload) => {
    const schema = z.object({
      repoRoot: z.string().min(1),
      resolvedFilePaths: z.array(z.string().min(1)),
      commitMessage: z.string().min(1),
    })
    const parsed = schema.safeParse(payload)
    if (!parsed.success) return { error: 'VALIDATION_ERROR' }
    try {
      const { repoRoot, resolvedFilePaths, commitMessage } = parsed.data
      await git(['add', '--', ...resolvedFilePaths], repoRoot)
      const out = await git(['commit', '-m', commitMessage], repoRoot)
      // Extract commit hash from output like "[main abc1234] message"
      const match = out.match(/\[[\w/]+\s+([a-f0-9]+)\]/)
      const commitHash = match?.[1] ?? 'unknown'

      // Push to the tracked upstream (set when the worktree was created from
      // origin/<headRefName>). We resolve the upstream explicitly because the
      // local branch name differs from the remote branch name (e.g., local is
      // "conflict-resolve/foo" but upstream is "origin/foo"). Best-effort —
      // local merge workflows may not have an upstream configured.
      let pushError: string | undefined
      try {
        const upstreamFull = await git(
          ['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{u}'],
          repoRoot
        )
        // upstreamFull is like "origin/test/conflict-theirs"
        const slashIdx = upstreamFull.indexOf('/')
        const remoteName = slashIdx === -1 ? 'origin' : upstreamFull.slice(0, slashIdx)
        const remoteBranch = slashIdx === -1 ? upstreamFull : upstreamFull.slice(slashIdx + 1)
        await git(
          ['push', '--force-with-lease', remoteName, `HEAD:refs/heads/${remoteBranch}`],
          repoRoot
        )
      } catch (pushErr) {
        pushError = String(pushErr)
      }

      return { commitHash, pushError }
    } catch (e) {
      return { error: String(e) }
    }
  })

  // git:prepare-pr-worktree
  // Creates a git worktree for the PR branch (using the remote tracking ref so it
  // matches what GitHub sees), runs git merge to produce conflict markers, then
  // returns { hasConflicts: true } so the merge-flow view can open.
  register('git:prepare-pr-worktree', async (payload) => {
    const schema = z.object({
      repoRoot: z.string().min(1),
      worktreePath: z.string().min(1),
      headRefName: z.string().min(1),
      baseRefName: z.string().min(1),
    })
    const parsed = schema.safeParse(payload)
    if (!parsed.success) return { error: 'VALIDATION_ERROR' }
    const { repoRoot, worktreePath, headRefName, baseRefName } = parsed.data
    try {
      // Deliberately do NOT run git fetch — it modifies shared git state and can
      // collide with other tasks (terminal sessions, builds, other git operations)
      // already running in this repo. The caller is expected to have up-to-date
      // remote tracking refs (they come from the normal git status polling).

      // Verify that origin/<head> and origin/<base> exist locally so we have
      // something to build the worktree from.
      const headRemote = `origin/${headRefName}`
      const baseRemote = `origin/${baseRefName}`
      const refsOk = await Promise.all([
        git(['rev-parse', '--verify', headRemote], repoRoot)
          .then(() => true)
          .catch(() => false),
        git(['rev-parse', '--verify', baseRemote], repoRoot)
          .then(() => true)
          .catch(() => false),
      ])
      if (!refsOk[0])
        return {
          error: `Remote ref '${headRemote}' not found locally. Run git fetch first, then try again.`,
        }
      if (!refsOk[1])
        return {
          error: `Remote ref '${baseRemote}' not found locally. Run git fetch first, then try again.`,
        }

      // Create a fresh local branch for the worktree, starting from origin/<head>.
      // Using a unique branch name (conflict-resolve/…) means we never hit the
      // "already checked out in another worktree" error, even if the user currently
      // has the PR branch checked out. Only this worktree's working directory is
      // affected — the main repo is untouched.
      const localBranch = `conflict-resolve/${headRefName.replace(/\//g, '-')}`
      await git(['worktree', 'add', '-B', localBranch, worktreePath, headRemote], repoRoot)

      try {
        await git(['merge', baseRemote], worktreePath)
        // Merged cleanly — no conflicts
        return { hasConflicts: false }
      } catch {
        const conflicted = await listConflictedFiles(worktreePath).catch(() => [])
        if (conflicted.length > 0) return { hasConflicts: true }
        // Merge failed for a non-conflict reason (e.g. unrelated histories)
        await git(['worktree', 'remove', '--force', worktreePath], repoRoot).catch(() => {})
        return { error: 'Merge failed with no conflict markers — check the branch state.' }
      }
    } catch (e) {
      await git(['worktree', 'remove', '--force', worktreePath], repoRoot).catch(() => {})
      return { error: String(e) }
    }
  })

  // git:prepare-merge-for-pr
  // Fetches the PR branch, checks it out, and runs git merge <base> to create
  // local conflict state so the merge-flow view can detect and resolve them.
  register('git:prepare-merge-for-pr', async (payload) => {
    const schema = z.object({
      repoRoot: z.string().min(1),
      headRefName: z.string().min(1),
      baseRefName: z.string().min(1),
    })
    const parsed = schema.safeParse(payload)
    if (!parsed.success) return { error: 'VALIDATION_ERROR' }
    const { repoRoot, headRefName, baseRefName } = parsed.data
    try {
      await git(['fetch', 'origin'], repoRoot)
      await git(['checkout', headRefName], repoRoot)
      try {
        await git(['merge', `origin/${baseRefName}`], repoRoot)
        // Clean merge — no conflicts
        return { hasConflicts: false }
      } catch {
        // git merge exits non-zero when conflicts exist — that is the expected path
        const conflicted = await listConflictedFiles(repoRoot).catch(() => [])
        if (conflicted.length > 0) return { hasConflicts: true }
        // merge failed for a non-conflict reason (permissions, etc.)
        return { error: 'Merge failed with no conflict markers — check git status.' }
      }
    } catch (e) {
      return { error: String(e) }
    }
  })

  // git:merge-ai-suggest (stub — Phase 3)
  register('git:merge-ai-suggest', async (payload) => {
    const schema = z.object({
      repoRoot: z.string().min(1),
      blockId: z.string().min(1),
      baseText: z.string(),
      oursText: z.string(),
      theirsText: z.string(),
      contextBefore: z.array(z.string()),
      contextAfter: z.array(z.string()),
    })
    const parsed = schema.safeParse(payload)
    if (!parsed.success) return { error: 'VALIDATION_ERROR' }
    return { error: 'NOT_IMPLEMENTED' }
  })

  // git:session-restore
  register('git:session-restore', async (payload) => {
    const schema = z.object({ repoRoot: z.string().min(1) })
    const parsed = schema.safeParse(payload)
    if (!parsed.success) return { error: 'VALIDATION_ERROR' }
    try {
      const { repoRoot } = parsed.data
      const stored = store.get(sessionKey(repoRoot)) as unknown
      if (!stored) return { session: null }

      // Validate that conflicts still exist in the working tree
      const conflicted = await listConflictedFiles(repoRoot).catch(() => [])
      if (conflicted.length === 0) {
        store.delete(sessionKey(repoRoot))
        return { session: null }
      }

      // Reject stale empty sessions (e.g., from a broken Start Over)
      const sessionObj = stored as { totalConflicts?: number; files?: unknown[] }
      if (!sessionObj.totalConflicts || sessionObj.totalConflicts === 0) {
        store.delete(sessionKey(repoRoot))
        return { session: null }
      }

      return { session: stored }
    } catch (e) {
      return { error: String(e) }
    }
  })

  // git:session-persist
  register('git:session-persist', async (payload) => {
    const schema = z.object({
      repoRoot: z.string().min(1),
      session: z.unknown(),
    })
    const parsed = schema.safeParse(payload)
    if (!parsed.success) return { error: 'VALIDATION_ERROR' }
    try {
      store.set(sessionKey(parsed.data.repoRoot), parsed.data.session)
      return { success: true }
    } catch (e) {
      return { error: String(e) }
    }
  })

  // git:session-clear
  register('git:session-clear', async (payload) => {
    const schema = z.object({ repoRoot: z.string().min(1) })
    const parsed = schema.safeParse(payload)
    if (!parsed.success) return { success: true }
    try {
      store.delete(sessionKey(parsed.data.repoRoot))
    } catch {
      // session-clear never fails per contract
    }
    return { success: true }
  })

  // git:session-reset — restore all conflict markers and clear persisted session
  register('git:session-reset', async (payload) => {
    const fileSchema = z.object({ filePath: z.string() })
    const schema = z.object({
      repoRoot: z.string().min(1),
      files: z.array(fileSchema),
    })
    const parsed = schema.safeParse(payload)
    if (!parsed.success) return { error: 'VALIDATION_ERROR' }
    try {
      const { repoRoot, files } = parsed.data
      for (const file of files) {
        // git checkout --conflict=merge re-introduces conflict markers reliably
        // regardless of whether block.resolvedText is populated in persisted sessions
        await git(['checkout', '--conflict=merge', '--', file.filePath], repoRoot)
      }
      store.delete(sessionKey(repoRoot))
      return { success: true }
    } catch (e) {
      return { error: String(e) }
    }
  })
}
