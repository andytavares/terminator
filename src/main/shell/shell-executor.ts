import { execFile as execFileCb, type ChildProcess, type ExecFileException } from 'child_process'
import { loginShellPathReady } from './login-shell-path.js'
import { realpath } from 'fs/promises'
import { basename, dirname, isAbsolute, join, relative, sep } from 'path'

/** The only commands any caller may run; the shell:exec channel's schema is built from it. */
export const ALLOWED_COMMAND_NAMES = ['git', 'gh'] as const
const ALLOWED_COMMANDS = new Set<string>(ALLOWED_COMMAND_NAMES)

export interface ShellExecInput {
  command: string
  args: string[]
  cwd: string
  timeoutMs?: number
  /** Most bytes kept per stream; past it the command is stopped. Node's default is 1 MiB. */
  maxBuffer?: number
  /** Added over the minimal environment every command gets. */
  env?: Record<string, string>
  encoding?: 'utf8' | 'buffer'
  /** Written to the command's stdin, which is then closed. */
  input?: string
  /** Each chunk of stdout and stderr as it arrives, in text mode. */
  onOutput?: (chunk: string) => void
}

export interface ShellExecOutput<Output extends string | Buffer = string> {
  exitCode: number
  stdout: Output
  stderr: Output
  timedOut: boolean
  exceededMaxBuffer: boolean
}

export class CommandNotAllowedError extends Error {
  readonly code = 'COMMAND_NOT_ALLOWED'
  constructor(command: string) {
    super(`Command "${command}" is not in the allowlist. Only git and gh are permitted.`)
  }
}

/** Named so it survives the extension host's link, where only `name` and `message` cross. */
export class CwdOutOfScopeError extends Error {
  readonly code = 'CWD_OUT_OF_SCOPE'
  constructor(cwd: string) {
    super(`"${cwd}" is outside every directory git and gh may run in`)
    this.name = 'CwdOutOfScopeError'
  }
}

export function assertCommandAllowed(command: string): void {
  if (!ALLOWED_COMMANDS.has(command)) {
    throw new CommandNotAllowedError(command)
  }
}

/**
 * Refuses a `cwd` that is not one of `roots` or below one (ADR 102). Both sides
 * are compared after realpath, so a symlink inside a root cannot lead out of it.
 */
export async function assertCwdInScope(cwd: string, roots: readonly string[]): Promise<void> {
  if (!isAbsolute(cwd)) throw new CwdOutOfScopeError(cwd)
  const real = await realPathOf(cwd)
  const realRoots = await Promise.all(roots.filter((root) => isAbsolute(root)).map(realPathOf))
  if (!realRoots.some((root) => isWithin(real, root))) throw new CwdOutOfScopeError(cwd)
}

/**
 * The real path of `target`, or of its nearest existing ancestor with the rest
 * appended: a directory not created yet (a clone target) is still somewhere.
 */
async function realPathOf(target: string): Promise<string> {
  try {
    return await realpath(target)
  } catch {
    return join(await realPathOf(dirname(target)), basename(target))
  }
}

/** A path-segment check: `/a/bc` is not within `/a/b`. */
function isWithin(path: string, root: string): boolean {
  const rel = relative(root, path)
  return rel === '' || (!isAbsolute(rel) && rel !== '..' && !rel.startsWith(`..${sep}`))
}

// Matches the exit status of timeout(1).
const TIMEOUT_EXIT_CODE = 124

function numericExitCode(code: string | number | undefined | null): number {
  return typeof code === 'number' && code !== 0 ? code : 1
}

function baseEnvironment(): NodeJS.ProcessEnv {
  return {
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
  }
}

/** stderr, or why the command did not run to completion when it said nothing itself. */
function stderrOf(error: ExecFileException | null, stderr: string | Buffer): string | Buffer {
  // A string code means the command did not run to completion (e.g. ENOENT); say why.
  const reason = typeof error?.code === 'string' && stderr.length === 0 ? error.message : ''
  if (!reason) return stderr
  return typeof stderr === 'string' ? reason : Buffer.from(reason)
}

function toOutput(
  error: ExecFileException | null,
  stdout: string | Buffer,
  stderr: string | Buffer
): ShellExecOutput<string | Buffer> {
  // The timeout kills the child with a signal, so node reports code null and killed true.
  const timedOut = error?.killed === true && error.code == null
  const exceededMaxBuffer = error?.code === 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER'
  const exitCode = !error ? 0 : timedOut ? TIMEOUT_EXIT_CODE : numericExitCode(error.code)
  return { exitCode, stdout, stderr: stderrOf(error, stderr), timedOut, exceededMaxBuffer }
}

export function execShell(
  input: ShellExecInput & { encoding: 'buffer' }
): Promise<ShellExecOutput<Buffer>>
export function execShell(input: ShellExecInput): Promise<ShellExecOutput>
export async function execShell(input: ShellExecInput): Promise<ShellExecOutput<string | Buffer>> {
  const { command, args, cwd, timeoutMs = 10000, maxBuffer, env, encoding = 'utf8' } = input
  // The PATH is read at spawn time, after the login shell's has been adopted.
  await loginShellPathReady()
  return new Promise((resolve) => {
    const child = execFileCb(
      command,
      args,
      {
        cwd,
        shell: false,
        timeout: timeoutMs,
        encoding,
        ...(maxBuffer === undefined ? {} : { maxBuffer }),
        env: { ...baseEnvironment(), ...env },
      },
      (error, stdout, stderr) => resolve(toOutput(error, stdout, stderr))
    )
    child.on('error', () => {
      // handled in callback
    })
    if (input.onOutput) streamOutput(child, input.onOutput)
    if (input.input !== undefined) child.stdin?.end(input.input)
  })
}

function streamOutput(child: ChildProcess, onOutput: (chunk: string) => void): void {
  const forward = (chunk: Buffer | string) => onOutput(chunk.toString())
  child.stdout?.on('data', forward)
  child.stderr?.on('data', forward)
}
