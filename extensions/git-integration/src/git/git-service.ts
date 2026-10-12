import { stripVTControlCharacters } from 'util'
import type { GitStatus, FileDiff } from '../schemas/git.schema.js'
import { parseStatus, parseDiff } from './git-parser.js'
import { GitCommandError, runGit } from '../shell/run-git.js'

const GIT_TIMEOUT = 10_000
const HOOK_TIMEOUT = 120_000
const DIFF_MAX_BYTES = 500 * 1024

interface CommitSuccess {
  commitHash: string
}

interface CommitError {
  error: string
  hookOutput?: string
  isHookFailure?: boolean
}

export type CommitResult = CommitSuccess | CommitError

function git(args: string[], cwd: string, options: { raw?: boolean } = {}): Promise<string> {
  return runGit(cwd, args, { timeoutMs: GIT_TIMEOUT, ...options })
}

export async function getStatus(repoRoot: string, maxFiles: number = 500): Promise<GitStatus> {
  const [statusOut, branch] = await Promise.all([
    git(['status', '--porcelain=v1', '-z'], repoRoot, { raw: true }),
    git(['branch', '--show-current'], repoRoot).catch(() => 'HEAD'),
  ])
  const partial = parseStatus(statusOut, maxFiles)
  return { ...partial, branch: branch || 'HEAD' }
}

function diff(args: string[], repoRoot: string): Promise<string> {
  return runGit(repoRoot, args, {
    timeoutMs: GIT_TIMEOUT,
    maxBuffer: DIFF_MAX_BYTES + 1024,
    raw: true,
  })
}

export async function getDiff(
  repoRoot: string,
  filePath: string,
  staged: boolean,
  isUntracked = false
): Promise<FileDiff> {
  const args = staged
    ? ['diff', '--cached', '--unified=3', '--', filePath]
    : ['diff', '--unified=3', '--', filePath]

  const stdout = await diff(args, repoRoot)

  // Untracked files produce no output from `git diff` because git has no index entry.
  // Use --no-index to compare /dev/null against the file, showing all lines as additions.
  // git diff --no-index exits with code 1 when files differ (normal), so stdout is in the error.
  if (!staged && isUntracked && !stdout.trim()) {
    try {
      const noIndexOut = await diff(
        ['diff', '--no-index', '--unified=3', '--', '/dev/null', filePath],
        repoRoot
      )
      return { ...parseDiff(noIndexOut, DIFF_MAX_BYTES), path: filePath }
    } catch (e: unknown) {
      if (e instanceof GitCommandError && e.stdout) {
        return { ...parseDiff(e.stdout, DIFF_MAX_BYTES), path: filePath }
      }
    }
  }

  return { ...parseDiff(stdout, DIFF_MAX_BYTES), path: filePath }
}

export async function stageFiles(repoRoot: string, paths: string[]): Promise<void> {
  await git(['add', '--', ...paths], repoRoot)
}

export async function unstageFiles(repoRoot: string, paths: string[]): Promise<void> {
  await git(['restore', '--staged', '--', ...paths], repoRoot)
}

export interface PushSuccess {
  success: true
  branch: string
  remote: string
}

export interface PushError {
  error: string
}

// Shared by git.ipc.ts (renderer-triggered push) and the Git quick action
// (main-process-triggered push), so the git CLI invocation lives once.
export async function pushBranch(repoRoot: string): Promise<PushSuccess | PushError> {
  try {
    await git(['push'], repoRoot)
  } catch (e) {
    const msg = String(e)
    if (msg.includes('has no upstream')) return { error: 'NO_UPSTREAM' }
    if (msg.includes('rejected')) return { error: 'REJECTED' }
    return { error: msg }
  }
  const branch = await git(['branch', '--show-current'], repoRoot).catch(() => '')
  let remote = 'origin'
  try {
    const upstream = await git(
      ['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{u}'],
      repoRoot
    )
    remote = upstream.split('/')[0] || 'origin'
  } catch {
    // No upstream to read a remote name from — origin is the git default.
  }
  return { success: true, branch, remote }
}

export async function pullFastForward(
  repoRoot: string
): Promise<{ success: true; branch: string } | { error: string }> {
  try {
    await git(['pull', '--ff-only'], repoRoot)
  } catch (e) {
    return { error: String(e) }
  }
  const branch = await git(['branch', '--show-current'], repoRoot).catch(() => '')
  return { success: true, branch }
}

/** Hands each non-blank line of a chunk to `onOutput`, without terminal escapes. */
function lineEmitter(onOutput?: (line: string) => void): ((chunk: string) => void) | undefined {
  if (!onOutput) return undefined
  return (chunk) => {
    for (const line of stripVTControlCharacters(chunk).split('\n')) {
      if (line.trim()) onOutput(line.trimEnd())
    }
  }
}

function isHookFailure(stderr: string): boolean {
  // git reports "hook failed" / "hook exited with code", or a hook runner
  // (husky, lefthook) writes output before failing.
  return ['hook failed', 'hook exited with code', 'husky -', 'lefthook'].some((marker) =>
    stderr.includes(marker)
  )
}

function commitFailure(error: GitCommandError): CommitError {
  const combined = stripVTControlCharacters(
    [error.stdout, error.stderr].filter(Boolean).join('\n').trim()
  )
  if (combined.includes('nothing to commit')) return { error: 'NOTHING_TO_COMMIT' }
  const hookFailed = isHookFailure(error.stderr)
  return {
    error: hookFailed ? 'HOOK_FAILED' : combined || 'Commit failed',
    hookOutput: combined || undefined,
    isHookFailure: hookFailed,
  }
}

export async function commitChanges(
  repoRoot: string,
  message: string,
  signOff = false,
  noVerify = false,
  onOutput?: (line: string) => void
): Promise<CommitResult> {
  const args = ['commit', '-m', message]
  if (signOff) args.push('--signoff')
  if (noVerify) args.push('--no-verify')
  try {
    const stdout = await runGit(repoRoot, args, {
      timeoutMs: HOOK_TIMEOUT,
      raw: true,
      onOutput: lineEmitter(onOutput),
    })
    const match = stdout.match(/^\[.+? ([a-f0-9]+)\]/m)
    return { commitHash: match?.[1] ?? '' }
  } catch (e) {
    if (!(e instanceof GitCommandError)) return { error: String(e) }
    if (e.timedOut) return { error: 'TIMEOUT' }
    return commitFailure(e)
  }
}
