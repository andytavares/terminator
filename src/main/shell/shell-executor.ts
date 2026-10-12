import { execFile as execFileCb } from 'child_process'
import { relative, isAbsolute } from 'path'

const ALLOWED_COMMANDS = new Set(['git', 'gh'])

export interface ShellExecInput {
  command: string
  args: string[]
  cwd: string
  timeoutMs?: number
}

export interface ShellExecOutput {
  exitCode: number
  stdout: string
  stderr: string
  timedOut: boolean
}

export class CommandNotAllowedError extends Error {
  readonly code = 'COMMAND_NOT_ALLOWED'
  constructor(command: string) {
    super(`Command "${command}" is not in the allowlist. Only git and gh are permitted.`)
  }
}

export class CwdOutOfScopeError extends Error {
  readonly code = 'CWD_OUT_OF_SCOPE'
  constructor(cwd: string, workspaceRoot: string) {
    super(`cwd "${cwd}" is outside workspace root "${workspaceRoot}"`)
  }
}

export function assertCommandAllowed(command: string): void {
  if (!ALLOWED_COMMANDS.has(command)) {
    throw new CommandNotAllowedError(command)
  }
}

export function assertCwdInScope(cwd: string, workspaceRoot: string): void {
  if (!isAbsolute(cwd) || !isAbsolute(workspaceRoot)) {
    throw new CwdOutOfScopeError(cwd, workspaceRoot)
  }
  const rel = relative(workspaceRoot, cwd)
  if (rel.startsWith('..') || isAbsolute(rel)) {
    throw new CwdOutOfScopeError(cwd, workspaceRoot)
  }
}

// Matches the exit status of timeout(1).
const TIMEOUT_EXIT_CODE = 124

function numericExitCode(code: string | number | undefined | null): number {
  return typeof code === 'number' && code !== 0 ? code : 1
}

export function execShell(input: ShellExecInput): Promise<ShellExecOutput> {
  const { command, args, cwd, timeoutMs = 10000 } = input
  return new Promise((resolve) => {
    const child = execFileCb(
      command,
      args,
      {
        cwd,
        shell: false,
        timeout: timeoutMs,
        env: {
          PATH: process.env.PATH,
          HOME: process.env.HOME,
          USER: process.env.USER,
          LOGNAME: process.env.LOGNAME,
          SHELL: process.env.SHELL,
          TMPDIR: process.env.TMPDIR,
          // git credentials
          GIT_TERMINAL_PROMPT: '0',
          GIT_ASKPASS: process.env.GIT_ASKPASS,
          SSH_AUTH_SOCK: process.env.SSH_AUTH_SOCK,
          // gh CLI auth — token takes precedence over config dir auth
          GH_TOKEN: process.env.GH_TOKEN,
          GITHUB_TOKEN: process.env.GITHUB_TOKEN,
          // gh config location (used when no token env var is set)
          XDG_CONFIG_HOME: process.env.XDG_CONFIG_HOME,
          XDG_DATA_HOME: process.env.XDG_DATA_HOME,
          APPDATA: process.env.APPDATA,
        },
      },
      (error, stdout, stderr) => {
        // The timeout kills the child with a signal, so node reports code null and killed true.
        const timedOut = error?.killed === true && error.code == null
        const exitCode = !error ? 0 : timedOut ? TIMEOUT_EXIT_CODE : numericExitCode(error.code)
        // A string code means the command never started (e.g. ENOENT), so it wrote nothing.
        const spawnError = typeof error?.code === 'string' && stderr === '' ? error.message : ''
        resolve({ exitCode, stdout, stderr: spawnError || stderr, timedOut })
      }
    )
    child.on('error', () => {
      // handled in callback
    })
  })
}
