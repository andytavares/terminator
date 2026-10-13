import { access, constants } from 'fs/promises'
import { resolve } from 'path'
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

export interface CommitOptions {
  signOff?: boolean
  noVerify?: boolean
  /** Receives each line the commit (and its hooks) print, as they print it. */
  onOutput?: (line: string) => void
}

/** Which version of a file to diff: the staged one or the working tree, and whether git tracks it. */
export interface DiffSide {
  staged: boolean
  isUntracked?: boolean
}

function gitInRepo(args: string[], cwd: string, options: { raw?: boolean } = {}): Promise<string> {
  return runGit(cwd, args, { timeoutMs: GIT_TIMEOUT, ...options })
}

export async function getStatus(repoRoot: string, maxFiles: number = 500): Promise<GitStatus> {
  const [statusOut, branch] = await Promise.all([
    gitInRepo(['status', '--porcelain=v1', '-z'], repoRoot, { raw: true }),
    gitInRepo(['branch', '--show-current'], repoRoot).catch(() => 'HEAD'),
  ])
  const partial = parseStatus(statusOut, maxFiles)
  return { ...partial, branch: branch || 'HEAD' }
}

function runDiff(args: string[], repoRoot: string): Promise<string> {
  return runGit(repoRoot, args, {
    timeoutMs: GIT_TIMEOUT,
    maxBuffer: DIFF_MAX_BYTES + 1024,
    raw: true,
  })
}

/** An untracked file against /dev/null; git exits 1 when they differ, with the diff on stdout. */
async function untrackedFileDiff(repoRoot: string, filePath: string): Promise<string | null> {
  try {
    return await runDiff(
      ['diff', '--no-index', '--unified=3', '--', '/dev/null', filePath],
      repoRoot
    )
  } catch (e: unknown) {
    if (e instanceof GitCommandError && e.stdout) return e.stdout
    return null
  }
}

export async function getDiff(
  repoRoot: string,
  filePath: string,
  side: DiffSide
): Promise<FileDiff> {
  const args = side.staged
    ? ['diff', '--cached', '--unified=3', '--', filePath]
    : ['diff', '--unified=3', '--', filePath]
  const stdout = await runDiff(args, repoRoot)
  // `git diff` prints nothing for an untracked file: git has no index entry to compare.
  const untracked = !side.staged && side.isUntracked && !stdout.trim()
  const output = (untracked ? await untrackedFileDiff(repoRoot, filePath) : null) ?? stdout
  return { ...parseDiff(output, DIFF_MAX_BYTES), path: filePath }
}

export async function stageFiles(repoRoot: string, paths: string[]): Promise<void> {
  await gitInRepo(['add', '--', ...paths], repoRoot)
}

export async function unstageFiles(repoRoot: string, paths: string[]): Promise<void> {
  await gitInRepo(['restore', '--staged', '--', ...paths], repoRoot)
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
    await gitInRepo(['push'], repoRoot)
  } catch (e) {
    const msg = String(e)
    if (msg.includes('has no upstream')) return { error: 'NO_UPSTREAM' }
    if (msg.includes('rejected')) return { error: 'REJECTED' }
    return { error: msg }
  }
  const branch = await gitInRepo(['branch', '--show-current'], repoRoot).catch(() => '')
  let remote = 'origin'
  try {
    const upstream = await gitInRepo(
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
    await gitInRepo(['pull', '--ff-only'], repoRoot)
  } catch (e) {
    return { error: String(e) }
  }
  const branch = await gitInRepo(['branch', '--show-current'], repoRoot).catch(() => '')
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

/** The hooks `git commit` runs and `--no-verify` skips (https://git-scm.com/docs/git-commit#Documentation/git-commit.txt---no-verify). */
const VERIFY_HOOKS = ['pre-commit', 'commit-msg']

/** True when one of the commit's verify hooks is installed, where core.hooksPath puts it. */
async function hasVerifyHook(repoRoot: string): Promise<boolean> {
  const installed = await Promise.all(
    VERIFY_HOOKS.map(async (name) => {
      const path = await gitInRepo(['rev-parse', '--git-path', `hooks/${name}`], repoRoot)
      return access(resolve(repoRoot, path), constants.X_OK).then(
        () => true,
        () => false
      )
    })
  )
  return installed.includes(true)
}

/** A hook exiting non-zero aborts the commit and git prints nothing beside the hook's output
 *  (https://git-scm.com/docs/githooks#_pre_commit); git's own failures say `fatal:` or `error:`. */
async function plainHookFailed(repoRoot: string, output: string): Promise<boolean> {
  if (/^(fatal|error):/m.test(output)) return false
  return hasVerifyHook(repoRoot).catch(() => false)
}

async function commitFailure(error: GitCommandError, repoRoot: string): Promise<CommitError> {
  const combined = stripVTControlCharacters(
    [error.stdout, error.stderr].filter(Boolean).join('\n').trim()
  )
  if (combined.includes('nothing to commit')) return { error: 'NOTHING_TO_COMMIT' }
  const hookFailed = isHookFailure(error.stderr) || (await plainHookFailed(repoRoot, combined))
  return {
    error: hookFailed ? 'HOOK_FAILED' : combined || 'Commit failed',
    hookOutput: combined || undefined,
    isHookFailure: hookFailed,
  }
}

export async function commitChanges(
  repoRoot: string,
  message: string,
  options: CommitOptions = {}
): Promise<CommitResult> {
  const args = ['commit', '-m', message]
  if (options.signOff) args.push('--signoff')
  if (options.noVerify) args.push('--no-verify')
  try {
    const stdout = await runGit(repoRoot, args, {
      timeoutMs: HOOK_TIMEOUT,
      raw: true,
      onOutput: lineEmitter(options.onOutput),
    })
    const match = stdout.match(/^\[.+? ([a-f0-9]+)\]/m)
    return { commitHash: match?.[1] ?? '' }
  } catch (e) {
    if (!(e instanceof GitCommandError)) return { error: String(e) }
    if (e.timedOut) return { error: 'TIMEOUT' }
    return commitFailure(e, repoRoot)
  }
}
