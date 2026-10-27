import { z } from 'zod'

import type { ShellExec } from './integrate.js'

// The base branch's own CI result, read before any check runs here: a base that
// CI already calls broken needs no local proof of the same thing.

const CI_TIMEOUT_MS = 30_000
const MAX_ANCESTORS = 10

const RunsSchema = z.array(
  z.object({
    workflowName: z.string(),
    status: z.string(),
    conclusion: z.string(),
    url: z.string(),
  })
)

type Run = z.infer<typeof RunsSchema>[number]

async function runsOf(exec: ShellExec, cwd: string, commit: string): Promise<Run[]> {
  const { exitCode, stdout } = await exec({
    command: 'gh',
    args: ['run', 'list', '--commit', commit, '--json', 'conclusion,status,workflowName,url'],
    cwd,
    timeoutMs: CI_TIMEOUT_MS,
  })
  if (exitCode !== 0) return []
  const parsed = RunsSchema.safeParse(JSON.parse(stdout || '[]'))
  return parsed.success ? parsed.data : []
}

async function gitOutput(exec: ShellExec, cwd: string, args: string[]): Promise<string | null> {
  const { exitCode, stdout } = await exec({ command: 'git', args, cwd })
  return exitCode === 0 ? stdout.trim() : null
}

/** The sentence naming the workflow that failed on `commit` (or its nearest ancestor with runs), or null. */
export async function ciFailureOf(
  exec: ShellExec,
  at: { cwd: string; commit: string; baseBranch: string }
): Promise<string | null> {
  const { cwd, baseBranch } = at
  let sha: string | null = at.commit
  for (let depth = 0; sha !== null && depth < MAX_ANCESTORS; depth++) {
    const runs = await runsOf(exec, cwd, sha).catch(() => [])
    if (runs.length > 0) {
      const failed = runs.find((run) => run.status === 'completed' && run.conclusion === 'failure')
      return failed === undefined
        ? null
        : `${baseBranch} failed in CI: ${failed.workflowName} (${failed.url}).`
    }
    const message = await gitOutput(exec, cwd, ['log', '-1', '--format=%B', sha])
    if (!message?.includes('[skip ci]')) return null
    sha = await gitOutput(exec, cwd, ['rev-parse', `${sha}^`])
  }
  return null
}
