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
  if (checks.length === 0) {
    return { kind: 'not_measured', checks, reason: 'no checks were reported' }
  }
  if (checks.some((c) => c.bucket === 'pending')) return null
  if (checks.some((c) => c.bucket === 'fail' || c.bucket === 'cancel')) {
    return { kind: 'red', checks }
  }
  return { kind: 'green', checks }
}

export async function watchChecks(
  pull: { url: string; cwd: string },
  exec: ShellExec,
  opts: {
    sleep: (ms: number) => Promise<void>
    pollMs?: number
    timeoutMs?: number
    onPoll?: (checks: readonly Check[]) => void
  }
): Promise<CiVerdict> {
  const pollMs = opts.pollMs ?? DEFAULT_POLL_MS
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS
  let waited = 0

  for (;;) {
    const result: ExecResult = await exec({
      command: 'gh',
      args: ['pr', 'checks', pull.url, '--json', 'name,bucket,link,workflow'],
      cwd: pull.cwd,
    })

    if (result.exitCode !== 0) {
      const message = `${result.stderr}${result.stdout}`
      if (/no checks reported/i.test(message)) {
        return { kind: 'not_measured', checks: [], reason: message.trim() }
      }
      return { kind: 'not_measured', checks: [], reason: result.stderr.trim() || message.trim() }
    }

    const checks = parseChecks(result.stdout)
    if (!checks) {
      return {
        kind: 'not_measured',
        checks: [],
        reason: result.stderr.trim() || 'unparseable checks output',
      }
    }

    opts.onPoll?.(checks)

    const verdict = verdictFor(checks)
    if (verdict) return verdict

    if (waited >= timeoutMs) {
      const minutes = Math.round(timeoutMs / 60_000)
      return { kind: 'not_measured', checks, reason: `still pending after ${minutes} minutes` }
    }

    await opts.sleep(pollMs)
    waited += pollMs
  }
}

/** Pulls the numeric run id out of a `.../actions/runs/<id>/job/<id>` link. */
function runIdFrom(link: string): string | null {
  const match = link.match(/\/actions\/runs\/(\d+)/)
  return match ? match[1] : null
}

export async function failedLogs(
  checks: readonly Check[],
  cwd: string,
  exec: ShellExec,
  maxLines = 200
): Promise<string> {
  const failed = checks.filter((c) => c.bucket === 'fail' || c.bucket === 'cancel')
  const runIds = new Set<string>()
  const noRunId: Check[] = []

  for (const c of failed) {
    const id = runIdFrom(c.link)
    if (id) runIds.add(id)
    else noRunId.push(c)
  }

  const blocks: string[] = []

  for (const id of runIds) {
    const heading = failed.find((c) => runIdFrom(c.link) === id)
    const label = heading ? `${heading.workflow}/${heading.name}` : id
    try {
      const result = await exec({ command: 'gh', args: ['run', 'view', id, '--log-failed'], cwd })
      blocks.push(`## ${label} (run ${id})\n${result.stdout}`)
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err)
      blocks.push(`## ${label} (run ${id})\nlog could not be read: ${reason}`)
    }
  }

  for (const c of noRunId) {
    blocks.push(`## ${c.workflow}/${c.name}\n${c.link}`)
  }

  const combined = blocks.join('\n\n')
  const lines = combined.split('\n')
  return lines.slice(-maxLines).join('\n')
}
