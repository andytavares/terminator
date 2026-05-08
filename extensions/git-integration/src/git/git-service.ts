import { execFile as execFileCb } from 'child_process'
import { promisify } from 'util'
import type { GitStatus, FileDiff } from '../schemas/git.schema.js'
import { parseStatus, parseDiff } from './git-parser.js'

const execFile = promisify(execFileCb)

const GIT_TIMEOUT = 10_000
const DIFF_MAX_BYTES = 500 * 1024

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

export async function getDiff(repoRoot: string, filePath: string, staged: boolean): Promise<FileDiff> {
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
  signOff: boolean = false
): Promise<string> {
  const args = ['commit', '-m', message]
  if (signOff) args.push('--signoff')
  const output = await git(args, repoRoot)
  const match = output.match(/\[[\w/]+ ([a-f0-9]+)\]/)
  return match?.[1] ?? ''
}
