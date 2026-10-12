import type { ExtensionAPI, ShellExecResult } from '@terminator/extension-sdk'

// Every git command this extension runs goes through the core's shell.exec
// (ADR 094), bound once in activate().

type Shell = ExtensionAPI['shell']

let boundShell: Shell | undefined

export function bindShell(shell: Shell): void {
  boundShell = shell
}

/** A git command that exited non-zero; the message carries its stderr. */
export class GitCommandError extends Error {
  readonly stdout: string
  readonly stderr: string
  readonly timedOut: boolean
  readonly exceededMaxBuffer: boolean

  constructor(args: readonly string[], result: ShellExecResult) {
    super(`Command failed: git ${args.join(' ')}\n${result.stderr}`)
    this.name = 'GitCommandError'
    this.stdout = result.stdout
    this.stderr = result.stderr
    this.timedOut = result.timedOut
    this.exceededMaxBuffer = result.exceededMaxBuffer
  }
}

export interface GitRunOptions {
  /** Default 30 000. */
  timeoutMs?: number
  maxBuffer?: number
  /** Keep leading and trailing whitespace, which file content needs for its line numbers. */
  raw?: boolean
  onOutput?: (chunk: string) => void
}

/** Runs git in `cwd`; resolves its stdout, trimmed unless `raw`, and rejects on a non-zero exit. */
export async function runGit(
  cwd: string,
  args: string[],
  options: GitRunOptions = {}
): Promise<string> {
  if (!boundShell) throw new Error('git-integration: activate() has not bound the shell')
  const { timeoutMs = 30_000, maxBuffer, raw, onOutput } = options
  const result = await boundShell.exec({
    command: 'git',
    args,
    cwd,
    timeoutMs,
    ...(maxBuffer === undefined ? {} : { maxBuffer }),
    ...(onOutput ? { onOutput } : {}),
  })
  if (result.exitCode !== 0) throw new GitCommandError(args, result)
  return raw ? result.stdout : result.stdout.trim()
}

/** True when a git command stopped because its output passed `maxBuffer`. */
export function exceededMaxBuffer(error: unknown): boolean {
  return error instanceof GitCommandError && error.exceededMaxBuffer
}
