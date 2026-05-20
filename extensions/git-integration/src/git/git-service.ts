import { execFile as execFileCb, spawn } from 'child_process'
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
  staged: boolean,
  isUntracked = false
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

  // Untracked files produce no output from `git diff` because git has no index entry.
  // Use --no-index to compare /dev/null against the file, showing all lines as additions.
  // git diff --no-index exits with code 1 when files differ (normal), so stdout is in the error.
  if (!staged && isUntracked && !stdout.trim()) {
    try {
      const { stdout: noIndexOut } = await execFile(
        'git',
        ['diff', '--no-index', '--unified=3', '--', '/dev/null', filePath],
        {
          cwd: repoRoot,
          timeout: GIT_TIMEOUT,
          maxBuffer: DIFF_MAX_BYTES + 1024,
          env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
        }
      )
      return { ...parseDiff(noIndexOut, DIFF_MAX_BYTES), path: filePath }
    } catch (e: unknown) {
      const err = e as { stdout?: string }
      if (err.stdout) return { ...parseDiff(err.stdout, DIFF_MAX_BYTES), path: filePath }
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

export function commitChanges(
  repoRoot: string,
  message: string,
  signOff = false,
  noVerify = false,
  onOutput?: (line: string) => void
): Promise<CommitResult> {
  const args = ['commit', '-m', message]
  if (signOff) args.push('--signoff')
  if (noVerify) args.push('--no-verify')

  return new Promise((resolve) => {
    const proc = spawn('git', args, {
      cwd: repoRoot,
      env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
    })

    let stdout = ''
    let stderr = ''
    let timedOut = false

    const killTimer = setTimeout(() => {
      timedOut = true
      proc.kill()
    }, HOOK_TIMEOUT)

    const emit = (chunk: Buffer) => {
      const text = stripAnsi(chunk.toString())
      if (onOutput) {
        for (const line of text.split('\n')) {
          if (line.trim()) onOutput(line.trimEnd())
        }
      }
    }

    proc.stdout.on('data', (chunk: Buffer) => {
      stdout += chunk.toString()
      emit(chunk)
    })
    proc.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString()
      emit(chunk)
    })

    proc.on('close', (code) => {
      clearTimeout(killTimer)
      if (timedOut) {
        resolve({ error: 'TIMEOUT' })
        return
      }
      if (code === 0) {
        const match = stdout.trim().match(/\[[\w/]+ ([a-f0-9]+)\]/)
        resolve({ commitHash: match?.[1] ?? '' })
        return
      }
      const combined = stripAnsi([stdout, stderr].filter(Boolean).join('\n').trim())
      if (combined.includes('nothing to commit')) {
        resolve({ error: 'NOTHING_TO_COMMIT' })
        return
      }
      // Detect hook failures: git reports "hook failed" / "hook exited with code" in stderr,
      // or a hook runner (husky, lefthook) writes output before failing.
      const isHookFailure = !!(
        stderr &&
        (stderr.includes('hook failed') ||
          stderr.includes('hook exited with code') ||
          stderr.includes('husky -') ||
          stderr.includes('lefthook'))
      )
      resolve({
        error: isHookFailure ? 'HOOK_FAILED' : combined || 'Commit failed',
        hookOutput: combined || undefined,
        isHookFailure,
      })
    })

    proc.on('error', (err) => {
      clearTimeout(killTimer)
      resolve({ error: String(err) })
    })
  })
}
