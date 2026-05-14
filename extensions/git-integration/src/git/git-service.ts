import { execFile as execFileCb } from 'child_process'
import { promisify } from 'util'
import type { GitStatus, FileDiff } from '../schemas/git.schema.js'
import { parseStatus, parseDiff } from './git-parser.js'

const execFile = promisify(execFileCb)

const GIT_TIMEOUT = 10_000
const HOOK_TIMEOUT = 120_000
const DIFF_MAX_BYTES = 500 * 1024

export interface CommitSuccess {
  commitHash: string
}

export interface CommitError {
  error: string
  hookOutput?: string
  isHookFailure?: boolean
}

export type CommitResult = CommitSuccess | CommitError

function stripAnsi(str: string): string {
  // eslint-disable-next-line no-control-regex
  return str.replace(/\x1b\[[0-9;]*m/g, '').replace(/\x1b\[\??\d+[hl]/g, '')
}

async function git(args: string[], cwd: string): Promise<string> {
  const { stdout } = await execFile('git', args, {
    cwd,
    timeout: GIT_TIMEOUT,
    env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
  })
  return stdout.trim()
}

export async function getStatus(repoRoot: string, maxFiles: number = 500): Promise<GitStatus> {
  const [statusOut, branch] = await Promise.all([
    execFile('git', ['status', '--porcelain=v1', '-z'], {
      cwd: repoRoot,
      timeout: GIT_TIMEOUT,
      env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
    }).then(({ stdout }) => stdout),
    git(['branch', '--show-current'], repoRoot).catch(() => 'HEAD'),
  ])
  const partial = parseStatus(statusOut, maxFiles)
  return { ...partial, branch: branch || 'HEAD' }
}

export async function getDiff(
  repoRoot: string,
  filePath: string,
  staged: boolean
): Promise<FileDiff> {
  const args = staged
    ? ['diff', '--cached', '--unified=3', '--', filePath]
    : ['diff', '--unified=3', '--', filePath]

  const { stdout } = await execFile('git', args, {
    cwd: repoRoot,
    timeout: GIT_TIMEOUT,
    maxBuffer: DIFF_MAX_BYTES + 1024,
    env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
  })
  return { ...parseDiff(stdout, DIFF_MAX_BYTES), path: filePath }
}

export async function stageFiles(repoRoot: string, paths: string[]): Promise<void> {
  await git(['add', '--', ...paths], repoRoot)
}

export async function unstageFiles(repoRoot: string, paths: string[]): Promise<void> {
  await git(['restore', '--staged', '--', ...paths], repoRoot)
}

export async function commitChanges(
  repoRoot: string,
  message: string,
  signOff = false,
  noVerify = false
): Promise<CommitResult> {
  const args = ['commit', '-m', message]
  if (signOff) args.push('--signoff')
  if (noVerify) args.push('--no-verify')
  try {
    const { stdout } = await execFile('git', args, {
      cwd: repoRoot,
      timeout: HOOK_TIMEOUT,
      env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
    })
    const match = stdout.trim().match(/\[[\w/]+ ([a-f0-9]+)\]/)
    return { commitHash: match?.[1] ?? '' }
  } catch (e: unknown) {
    const err = e as { stdout?: string; stderr?: string; killed?: boolean; message?: string }
    if (err.killed) return { error: 'TIMEOUT' }
    const combined = stripAnsi([err.stdout, err.stderr].filter(Boolean).join('\n').trim())
    if (combined.includes('nothing to commit')) return { error: 'NOTHING_TO_COMMIT' }
    // Detect hook failures: git reports "hook failed" / "hook exited with code" in stderr,
    // or a hook runner (husky, lefthook) writes output before failing.
    const isHookFailure = !!(
      err.stderr &&
      (err.stderr.includes('hook failed') ||
        err.stderr.includes('hook exited with code') ||
        err.stderr.includes('husky -') ||
        err.stderr.includes('lefthook'))
    )
    return {
      error: isHookFailure ? 'HOOK_FAILED' : combined || String(e),
      hookOutput: combined || undefined,
      isHookFailure,
    }
  }
}
