import { REPORT_REPOSITORY, type ReportingStatus } from '../../../core-shared/src/bug-report.js'
import type { RunCommand } from '../github/github-api.js'
import type { ShellExecOutput } from '../shell/shell-executor.js'

// Files a bug report as an issue on the app's repository through the user's own GitHub CLI
// (ADR 156). `gh issue create --attach` uploads images and videos and puts them in the body
// (https://cli.github.com/manual/gh_issue_create); no GitHub API does that.

export interface IssueInput {
  title: string
  body: string
  /** Absolute paths of the images and videos to attach. */
  files: readonly string[]
}

export type FiledIssue =
  | { ok: true; number: number; url: string }
  | { ok: false; error: 'SIGNED_OUT' | 'FAILED'; message: string }

const CHECK_TIMEOUT_MS = 15_000
/** Several videos of up to 10 MB each go up in one command. */
const UPLOAD_TIMEOUT_MS = 5 * 60_000

function saidSignIn(result: ShellExecOutput): boolean {
  const text = `${result.stderr}\n${result.stdout}`
  return text.includes('gh auth login') || text.includes('401')
}

/** Whether this machine can post a report with attachments, and as whom. The help text stands in
 * for a minimum version: which gh release added `--attach` is not documented. */
export async function reportingStatus(run: RunCommand, cwd: string): Promise<ReportingStatus> {
  const help = await run({
    command: 'gh',
    args: ['issue', 'create', '--help'],
    cwd,
    timeoutMs: CHECK_TIMEOUT_MS,
  })
  if (help.exitCode !== 0) return { ready: false, reason: 'no-gh' }
  if (!`${help.stdout}${help.stderr}`.includes('--attach')) {
    return { ready: false, reason: 'no-attach' }
  }
  const user = await run({
    command: 'gh',
    args: ['api', 'user', '--hostname', 'github.com', '--jq', '.login'],
    cwd,
    timeoutMs: CHECK_TIMEOUT_MS,
  })
  if (user.exitCode !== 0) return { ready: false, reason: 'signed-out' }
  return { ready: true, login: user.stdout.trim() }
}

function failure(result: ShellExecOutput): FiledIssue {
  if (result.timedOut)
    return { ok: false, error: 'FAILED', message: 'GitHub did not answer in time.' }
  const message = result.stderr.trim() || `gh exited with code ${result.exitCode}`
  return { ok: false, error: saidSignIn(result) ? 'SIGNED_OUT' : 'FAILED', message }
}

/** Creates the issue and answers with its number and link, as `gh` prints them. */
export async function fileIssue(
  run: RunCommand,
  cwd: string,
  issue: IssueInput
): Promise<FiledIssue> {
  const args = ['issue', 'create', '--repo', REPORT_REPOSITORY, '--title', issue.title]
  args.push('--body-file', '-', ...issue.files.flatMap((file) => ['--attach', file]))
  const result = await run({
    command: 'gh',
    args,
    cwd,
    input: issue.body,
    timeoutMs: UPLOAD_TIMEOUT_MS,
  })
  if (result.exitCode !== 0) return failure(result)
  const url = result.stdout.trim().split('\n').pop() ?? ''
  return { ok: true, number: Number(/\/issues\/(\d+)$/.exec(url)?.[1] ?? 0), url }
}
