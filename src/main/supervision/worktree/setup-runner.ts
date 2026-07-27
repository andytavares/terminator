import { spawn } from 'child_process'

// Runs the repository's declared setup, teardown and verify commands.
//
// All three are run here, not just setup: the config contract declares `verify`
// too, and parsing a key that is never executed would leave dead configuration
// in every repository that sets it.
//
// A non-zero setup exit marks the session `failed`, retains the output, and
// starts no agent (FR-034). That is the load-bearing behaviour — the category's
// usual failure is a broken worktree the operator only discovers from inside
// the agent's transcript.

export interface ScriptResult {
  readonly exitCode: number
  /** stdout and stderr interleaved, as the operator would have seen them. */
  readonly output: string
  readonly durationMs: number
}

export interface RunScriptOptions {
  command: string
  cwd: string
  env: Readonly<Record<string, string>>
  timeoutMs?: number
  now?: () => number
}

const DEFAULT_TIMEOUT_MS = 15 * 60_000

export function runScript(options: RunScriptOptions): Promise<ScriptResult> {
  const { command, cwd, env } = options
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS
  const now = options.now ?? Date.now
  const startedAt = now()

  return new Promise<ScriptResult>((resolve) => {
    // Through a shell, because the declared command is a shell one-liner —
    // `pnpm install --frozen-lockfile && pnpm db:branch $TERMINATOR_WORKITEM`.
    const child = spawn(command, {
      cwd,
      shell: true,
      env: { ...process.env, ...env },
    })

    let output = ''
    const capture = (chunk: Buffer): void => {
      output += chunk.toString()
    }
    child.stdout?.on('data', capture)
    child.stderr?.on('data', capture)

    const timer = setTimeout(() => {
      // A setup that never finishes is a failed setup. Hanging here would leave
      // the session in `starting` forever with nothing to show the operator.
      output += `\n[terminator] timed out after ${timeoutMs}ms`
      child.kill('SIGKILL')
    }, timeoutMs)

    const settle = (exitCode: number): void => {
      clearTimeout(timer)
      resolve({ exitCode, output, durationMs: now() - startedAt })
    }

    child.on('error', (error) => {
      output += `\n[terminator] ${error.message}`
      // Command not found, permission denied — indistinguishable from a
      // failing script as far as the operator's next move is concerned.
      settle(127)
    })
    child.on('close', (code) => settle(code ?? 1))
  })
}

/** The environment every script and agent session gets (FR-033). */
export function scriptEnv(input: {
  portBase: number
  worktreePath: string
  workItemId: string
}): Record<string, string> {
  return {
    TERMINATOR_PORT_BASE: String(input.portBase),
    TERMINATOR_WORKTREE: input.worktreePath,
    TERMINATOR_WORKITEM: input.workItemId,
  }
}
