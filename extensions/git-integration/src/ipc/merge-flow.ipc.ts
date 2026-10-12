import { z } from 'zod'
import { readFile } from 'fs/promises'
import { writeFileAtomic } from '../utils/write-atomic.js'
import { isAbsolute } from 'path'
import { namedStore } from '../storage-directory.js'
import { defineChannel } from '@terminator/extension-sdk'
import {
  buildConflictSession,
  readConflictBlocks,
  listConflictedFiles,
} from '../git/conflict-reader.js'
import { ResolutionStrategySchema } from '../schemas/merge-flow.schema.js'
import { runGit } from '../shell/run-git.js'
import { RepoRoot } from './repo-root.js'
import { VALIDATION_ERROR, errorEnvelope, type RegisterFn } from './register.js'

// electron-store's default name, kept so stored sessions survive the move.
const store = () => namedStore('config')

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

export function registerMergeFlowHandlers(register: RegisterFn): void {
  register(
    defineChannel({
      channel: 'git:conflicts-list',
      schema: RepoRootPayload,
      invalid: VALIDATION_ERROR,
      run: ({ repoRoot }) => buildConflictSession(repoRoot),
      onError: errorEnvelope,
    })
  )

  register(
    defineChannel({
      channel: 'git:resolve-conflict',
      schema: z.object({
        repoRoot: RepoRoot,
        blockId: BlockId,
        resolvedText: z.string(),
        strategy: ResolutionStrategySchema,
        currentResolvedText: z.string().optional(),
        originalConflictText: z.string().optional(),
      }),
      invalid: VALIDATION_ERROR,
      run: async ({
        repoRoot,
        blockId,
        resolvedText,
        currentResolvedText,
        originalConflictText,
      }) => {
        // blockId format: "relative/path/file.ts#index"
        const hashIdx = blockId.lastIndexOf('#')
        const filePath = blockId.slice(0, hashIdx)
        const fullPath = `${repoRoot}/${filePath}`
        const content = await readFile(fullPath, 'utf-8')

        // 1. Primary: match by original conflict text — stable regardless of how many
        //    blocks have already been resolved (block indices shift as markers are removed)
        if (originalConflictText && content.includes(originalConflictText)) {
          const updated = content.replace(originalConflictText, resolvedText)
          await writeFileAtomic(fullPath, updated)
          return { success: true }
        }

        // 2. Block already resolved — replace the previously written resolved text
        if (currentResolvedText && content.includes(currentResolvedText)) {
          const updated = content.replace(currentResolvedText, resolvedText)
          await writeFileAtomic(fullPath, updated)
          return { success: true }
        }

        // 3. Fallback: index-based lookup (for sessions started before this fix)
        const blocks = readConflictBlocks(filePath, content, '', '', '')
        const blockIndex = parseInt(blockId.slice(hashIdx + 1), 10)
        const target = blocks[blockIndex]
        if (target) {
          const updated = content.replace(target.originalConflictText, resolvedText)
          await writeFileAtomic(fullPath, updated)
          return { success: true }
        }

        // 4. No conflict markers remain for this block — it was already consumed by a
        //    previous resolution (possibly incorrect). Treat as a soft success so the
        //    session can finish navigating. The file content stays as-is.
        return { success: true }
      },
      onError: errorEnvelope,
    })
  )

  register(
    defineChannel({
      channel: 'git:undo-resolve',
      schema: z.object({
        repoRoot: RepoRoot,
        blockId: BlockId,
        resolvedText: z.string(),
        originalConflictText: z.string().min(1),
      }),
      invalid: VALIDATION_ERROR,
      run: async ({ repoRoot, blockId, resolvedText, originalConflictText }) => {
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
        await writeFileAtomic(fullPath, updated)
        return { success: true }
      },
      onError: errorEnvelope,
    })
  )

  register(
    defineChannel({
      channel: 'git:merge-commit',
      schema: z.object({
        repoRoot: RepoRoot,
        resolvedFilePaths: z.array(z.string().min(1)),
        commitMessage: z.string().min(1),
      }),
      invalid: VALIDATION_ERROR,
      run: async ({ repoRoot, resolvedFilePaths, commitMessage }) => {
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
      },
      onError: errorEnvelope,
    })
  )

  // Creates a git worktree for the PR branch (using the remote tracking ref so it
  // matches what GitHub sees), runs git merge to produce conflict markers, then
  // returns { hasConflicts: true } so the merge-flow view can open.
  register(
    defineChannel({
      channel: 'git:prepare-pr-worktree',
      schema: z.object({
        repoRoot: RepoRoot,
        worktreePath: z.string().min(1),
        headRefName: z.string().min(1),
        baseRefName: z.string().min(1),
      }),
      invalid: VALIDATION_ERROR,
      run: async ({ repoRoot, worktreePath, headRefName, baseRefName }) => {
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
          return errorEnvelope(e)
        }
      },
    })
  )

  register(
    defineChannel({
      channel: 'git:session-restore',
      schema: RepoRootPayload,
      invalid: VALIDATION_ERROR,
      run: async ({ repoRoot }) => {
        const sessions = await store()
        const stored = sessions.get(sessionKey(repoRoot)) as unknown
        if (!stored) return { session: null }

        // Validate that conflicts still exist in the working tree
        const conflicted = await listConflictedFiles(repoRoot).catch(() => [])
        if (conflicted.length === 0) {
          sessions.delete(sessionKey(repoRoot))
          return { session: null }
        }

        // Reject stale empty sessions (e.g., from a broken Start Over)
        const sessionObj = stored as { totalConflicts?: number; files?: unknown[] }
        if (!sessionObj.totalConflicts || sessionObj.totalConflicts === 0) {
          sessions.delete(sessionKey(repoRoot))
          return { session: null }
        }

        return { session: stored }
      },
      onError: errorEnvelope,
    })
  )

  register(
    defineChannel({
      channel: 'git:session-persist',
      schema: z.object({ repoRoot: RepoRoot, session: z.unknown() }),
      invalid: VALIDATION_ERROR,
      run: async ({ repoRoot, session }) => {
        const sessions = await store()
        sessions.set(sessionKey(repoRoot), session)
        return { success: true }
      },
      onError: errorEnvelope,
    })
  )

  // Never fails: clearing a session that cannot be cleared still answers success.
  register(
    defineChannel({
      channel: 'git:session-clear',
      schema: RepoRootPayload,
      invalid: { success: true },
      run: async ({ repoRoot }) => {
        const sessions = await store()
        sessions.delete(sessionKey(repoRoot))
        return { success: true }
      },
      onError: () => ({ success: true }),
    })
  )

  // Restores all conflict markers and clears the persisted session.
  register(
    defineChannel({
      channel: 'git:session-reset',
      schema: z.object({
        repoRoot: RepoRoot,
        files: z.array(z.object({ filePath: z.string() })),
      }),
      invalid: VALIDATION_ERROR,
      run: async ({ repoRoot, files }) => {
        for (const file of files) {
          // git checkout --conflict=merge re-introduces conflict markers reliably
          // regardless of whether block.resolvedText is populated in persisted sessions
          await git(['checkout', '--conflict=merge', '--', file.filePath], repoRoot)
        }
        const sessions = await store()
        sessions.delete(sessionKey(repoRoot))
        return { success: true }
      },
      onError: errorEnvelope,
    })
  )
}
