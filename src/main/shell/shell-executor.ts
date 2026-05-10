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

export function execShell(input: ShellExecInput): Promise<ShellExecOutput> {
  const { command, args, cwd, timeoutMs = 10000 } = input
  return new Promise((resolve) => {
    let timedOut = false
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
        const exitCode = error?.code != null ? (typeof error.code === 'number' ? error.code : 1) : 0
        resolve({ exitCode, stdout, stderr, timedOut })
      }
    )
    child.on('error', () => {
      // handled in callback
    })
    // node sets killed=true and emit 'close' with null code when timeout fires
    child.on('close', (code, signal) => {
      if (signal === 'SIGTERM' || signal === 'SIGKILL') timedOut = true
      void code
    })
  })
}
