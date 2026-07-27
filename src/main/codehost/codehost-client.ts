import { spawn } from 'child_process'
import { resolveCheckState, type CommandResult, type RunCommand } from './check-status.js'
import type { CheckState } from '../supervision/review/risk-grader.js'

// Core's own code-host access (ADR 029). Core cannot read this from the
// git-integration extension — unattended-merge safety turns on check state, and
// a safety property must not be contingent on an install.
//
// Shells out to `gh`, the same class of dependency core already accepts for
// `git`. Authentication is `gh auth login`'s problem, not ours.

export interface PullRequest {
  readonly number: number
  readonly url: string
  readonly state: 'OPEN' | 'MERGED' | 'CLOSED'
  readonly title: string
}

export interface MergeResult {
  readonly ok: boolean
  readonly reason: string | null
}

export interface CodeHostClient {
  checkState(repoPath: string, branch: string): Promise<CheckState>
  pullRequestFor(repoPath: string, branch: string): Promise<PullRequest | null>
  createPullRequest(repoPath: string, branch: string, title: string): Promise<PullRequest | null>
  merge(repoPath: string, branch: string): Promise<MergeResult>
  isAvailable(repoPath: string): Promise<boolean>
}

/** Real command execution. Arguments are passed as an array — never a shell string. */
export const runCommand: RunCommand = (command, args, cwd) =>
  new Promise<CommandResult>((resolve) => {
    const child = spawn(command, [...args], { cwd })
    let stdout = ''
    let stderr = ''
    child.stdout?.on('data', (chunk: Buffer) => (stdout += chunk.toString()))
    child.stderr?.on('data', (chunk: Buffer) => (stderr += chunk.toString()))
    child.on('error', (error) => resolve({ ok: false, stdout, stderr: error.message }))
    child.on('close', (code) => resolve({ ok: code === 0, stdout, stderr }))
  })

function parsePullRequest(stdout: string): PullRequest | null {
  try {
    const parsed = JSON.parse(stdout) as Record<string, unknown>
    if (typeof parsed.number !== 'number') return null
    return {
      number: parsed.number,
      url: typeof parsed.url === 'string' ? parsed.url : '',
      state: (typeof parsed.state === 'string' ? parsed.state : 'OPEN') as PullRequest['state'],
      title: typeof parsed.title === 'string' ? parsed.title : '',
    }
  } catch {
    return null
  }
}

export function createCodeHostClient(run: RunCommand = runCommand): CodeHostClient {
  return {
    checkState: (repoPath, branch) => resolveCheckState(repoPath, branch, run),

    async isAvailable(repoPath: string): Promise<boolean> {
      try {
        return (await run('gh', ['auth', 'status'], repoPath)).ok
      } catch {
        return false
      }
    },

    async pullRequestFor(repoPath: string, branch: string): Promise<PullRequest | null> {
      try {
        const result = await run(
          'gh',
          ['pr', 'view', branch, '--json', 'number,url,state,title'],
          repoPath
        )
        // No pull request for this branch is a normal answer, not an error.
        return result.ok ? parsePullRequest(result.stdout) : null
      } catch {
        return null
      }
    },

    async createPullRequest(
      repoPath: string,
      branch: string,
      title: string
    ): Promise<PullRequest | null> {
      try {
        const created = await run(
          'gh',
          ['pr', 'create', '--head', branch, '--title', title, '--fill'],
          repoPath
        )
        if (!created.ok) return null
      } catch {
        return null
      }
      return this.pullRequestFor(repoPath, branch)
    },

    async merge(repoPath: string, branch: string): Promise<MergeResult> {
      try {
        const result = await run('gh', ['pr', 'merge', branch, '--squash'], repoPath)
        return result.ok
          ? { ok: true, reason: null }
          : { ok: false, reason: result.stderr.trim() || 'gh pr merge exited non-zero' }
      } catch (error) {
        return { ok: false, reason: error instanceof Error ? error.message : String(error) }
      }
    },
  }
}
