import { timeoutNotice } from './integrate.js'
import type { ExecResult, ShellExec } from './integrate.js'

// A pull request's CI is read through `gh`, never re-derived: `gh pr checks`
// is the one source of truth for what ran and how it went.

export interface Check {
  readonly name: string
  readonly bucket: 'pass' | 'fail' | 'pending' | 'skipping' | 'cancel'
  readonly link: string
  readonly workflow: string
}

export type CiVerdict =
  | { readonly kind: 'green'; readonly checks: readonly Check[] }
  | { readonly kind: 'red'; readonly checks: readonly Check[] }
  | { readonly kind: 'not_measured'; readonly checks: readonly Check[]; readonly reason: string }

const DEFAULT_POLL_MS = 15_000
const DEFAULT_TIMEOUT_MS = 30 * 60_000
// A draft is polled seconds after `gh pr create`, before GitHub has registered
// the workflows a push starts; until this has passed, "no checks" means "not yet".
const DEFAULT_APPEAR_WITHIN_MS = 2 * 60_000

/** Parses `gh pr checks --json ...` output, or null if it doesn't parse. */
function parseChecks(stdout: string): Check[] | null {
  try {
    const parsed = JSON.parse(stdout)
    if (!Array.isArray(parsed)) return null
    return parsed as Check[]
  } catch {
    return null
  }
}

function verdictFor(checks: readonly Check[]): CiVerdict | null {
  if (checks.some((c) => c.bucket === 'pending')) return null
  if (checks.some((c) => c.bucket === 'fail' || c.bucket === 'cancel')) {
    return { kind: 'red', checks }
  }
  return { kind: 'green', checks }
}

export interface WatchOptions {
  sleep: (ms: number) => Promise<void>
  pollMs?: number
  timeoutMs?: number
  appearWithinMs?: number
  /** Run ids a previous round already judged; a pushed fix starts new ones. */
  ignoreRuns?: ReadonlySet<string>
  onPoll?: (checks: readonly Check[]) => void
}

/** What one `gh pr checks` said: nothing yet, an error, or the checks to judge. */
type Poll =
  | { readonly kind: 'none_yet'; readonly reason: string }
  | { readonly kind: 'unreadable'; readonly reason: string }
  | { readonly kind: 'checks'; readonly checks: readonly Check[] }

async function pollChecks(
  pull: { url: string; cwd: string },
  exec: ShellExec,
  ignoreRuns: ReadonlySet<string> | undefined
): Promise<Poll> {
  const result: ExecResult = await exec({
    command: 'gh',
    args: ['pr', 'checks', pull.url, '--json', 'name,bucket,link,workflow'],
    cwd: pull.cwd,
    timeoutMs: CHECKS_TIMEOUT_MS,
  })
  const message = `${result.stderr}${result.stdout}`.trim()
  if (result.exitCode !== 0) {
    return /no checks reported/i.test(message)
      ? { kind: 'none_yet', reason: message }
      : { kind: 'unreadable', reason: result.stderr.trim() || message }
  }
  const fresh = parseChecks(result.stdout)?.filter((c) => !ignoreRuns?.has(runIdFrom(c.link) ?? ''))
  if (fresh === undefined) {
    return { kind: 'unreadable', reason: result.stderr.trim() || 'unparseable checks output' }
  }
  if (fresh.length === 0) {
    return { kind: 'none_yet', reason: message === '[]' ? 'no checks were reported' : message }
  }
  return { kind: 'checks', checks: fresh }
}

export async function watchChecks(
  pull: { url: string; cwd: string },
  exec: ShellExec,
  opts: WatchOptions
): Promise<CiVerdict> {
  const { pollMs, timeoutMs, appearWithinMs } = timingOf(opts)
  for (let waited = 0; ; waited += pollMs) {
    const poll = await pollChecks(pull, exec, opts.ignoreRuns)
    if (poll.kind === 'unreadable') return { kind: 'not_measured', checks: [], reason: poll.reason }
    if (poll.kind === 'none_yet') {
      if (waited >= appearWithinMs) return { kind: 'not_measured', checks: [], reason: poll.reason }
    } else {
      opts.onPoll?.(poll.checks)
      const verdict = verdictFor(poll.checks) ?? stillPending(poll.checks, { waited, timeoutMs })
      if (verdict !== null) return verdict
    }
    await opts.sleep(pollMs)
  }
}

function timingOf(opts: WatchOptions) {
  return {
    pollMs: opts.pollMs ?? DEFAULT_POLL_MS,
    timeoutMs: opts.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    appearWithinMs: opts.appearWithinMs ?? DEFAULT_APPEAR_WITHIN_MS,
  }
}

/** Not measured once checks have stayed pending for the whole timeout; null until then. */
function stillPending(
  checks: readonly Check[],
  { waited, timeoutMs }: { waited: number; timeoutMs: number }
): CiVerdict | null {
  if (waited < timeoutMs) return null
  const minutes = Math.round(timeoutMs / 60_000)
  return { kind: 'not_measured', checks, reason: `still pending after ${minutes} minutes` }
}

/** Pulls the numeric run id out of a `.../actions/runs/<id>/job/<id>` link. */
export function runIdFrom(link: string): string | null {
  const match = link.match(/\/actions\/runs\/(\d+)/)
  return match ? match[1] : null
}

/** How much of the failed runs' logs to keep: the end, where the failure is. */
const MAX_LOG_LINES = 200
const CHECKS_TIMEOUT_MS = 60_000
const RUN_LOG_TIMEOUT_MS = 120_000

export async function failedLogs(
  checks: readonly Check[],
  cwd: string,
  exec: ShellExec
): Promise<string> {
  const failed = checks.filter((c) => c.bucket === 'fail' || c.bucket === 'cancel')
  const runIds = new Set(failed.map((c) => runIdFrom(c.link)).filter((id) => id !== null))
  const blocks: string[] = []
  for (const id of runIds) {
    const heading = failed.find((c) => runIdFrom(c.link) === id)
    const label = heading ? `${heading.workflow}/${heading.name}` : id
    blocks.push(`## ${label} (run ${id})\n${await runLog(id, cwd, exec)}`)
  }
  for (const c of failed.filter((check) => runIdFrom(check.link) === null)) {
    blocks.push(`## ${c.workflow}/${c.name}\n${c.link}`)
  }
  return blocks.join('\n\n').split('\n').slice(-MAX_LOG_LINES).join('\n')
}

async function runLog(id: string, cwd: string, exec: ShellExec): Promise<string> {
  try {
    const result = await exec({
      command: 'gh',
      args: ['run', 'view', id, '--log-failed'],
      cwd,
      timeoutMs: RUN_LOG_TIMEOUT_MS,
    })
    if (result.timedOut)
      return `log could not be read: ${timeoutNotice('gh run view', RUN_LOG_TIMEOUT_MS)}`
    if (result.exitCode !== 0) return `log could not be read: ${result.stderr.trim()}`
    return result.stdout
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err)
    return `log could not be read: ${reason}`
  }
}
