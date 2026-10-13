import { spawn, type ChildProcess } from 'child_process'
import { StringDecoder } from 'string_decoder'
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

/** @internal */
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
const DEFAULT_TIMEOUT_MS = 10_000
// execFile's default, which this runner replaced:
// https://nodejs.org/api/child_process.html#child_processexecfilefile-args-options-callback
const DEFAULT_MAX_BUFFER = 1024 * 1024

/**
 * Each command leads a process group of its own, so stopping it stops what it
 * started too: kill() with a negative pid signals the whole group
 * (https://nodejs.org/api/child_process.html#optionsdetached,
 * https://man7.org/linux/man-pages/man2/kill.2.html). Not on Windows, where
 * `detached` gives the command a console of its own instead.
 */
const OWN_PROCESS_GROUP = process.platform !== 'win32'

/** Commands started and not yet ended, for stopRunningCommands. */
const running = new Set<ChildProcess>()

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

function stopGroup(child: ChildProcess): void {
  if (child.pid === undefined) return
  try {
    process.kill(OWN_PROCESS_GROUP ? -child.pid : child.pid, 'SIGTERM')
  } catch {
    // Already gone.
  }
}

/**
 * Stops every git and gh command still running, with everything each one
 * started. The app calls it as it quits: on macOS /usr/bin/git is an xcrun shim
 * that can start xcodebuild, which outlived the app (run 38382115775).
 */
export function stopRunningCommands(): void {
  for (const child of running) stopGroup(child)
}

interface CommandRun {
  child: ChildProcess
  stdout: Buffer[]
  stderr: Buffer[]
  timedOut: boolean
  exceededMaxBuffer: boolean
  /** Why the command could not start, when it could not. */
  failure?: string
}

/** Keeps each stream's output up to `maxBuffer` bytes; past it the command is stopped. */
function collectOutput(run: CommandRun, input: ShellExecInput): void {
  const limit = input.maxBuffer ?? DEFAULT_MAX_BUFFER
  const keep = (stream: 'stdout' | 'stderr') => {
    const decoder = new StringDecoder('utf8')
    let bytes = 0
    return (chunk: Buffer): void => {
      if (input.onOutput) input.onOutput(decoder.write(chunk))
      bytes += chunk.length
      if (bytes <= limit) return void run[stream].push(chunk)
      run.exceededMaxBuffer = true
      stopGroup(run.child)
    }
  }
  run.child.stdout?.on('data', keep('stdout'))
  run.child.stderr?.on('data', keep('stderr'))
}

function startCommand(input: ShellExecInput, environment: NodeJS.ProcessEnv): CommandRun {
  const child = spawn(input.command, input.args, {
    cwd: input.cwd,
    shell: false,
    detached: OWN_PROCESS_GROUP,
    windowsHide: true,
    env: { ...environment, ...input.env },
  })
  const run: CommandRun = {
    child,
    stdout: [],
    stderr: [],
    timedOut: false,
    exceededMaxBuffer: false,
  }
  running.add(child)
  collectOutput(run, input)
  // A command that has exited, or never started, cannot take its input.
  child.stdin?.on('error', () => {})
  if (input.input !== undefined) child.stdin?.end(input.input)
  return run
}

function exitCodeOf(run: CommandRun, code: number | null): number {
  if (run.timedOut) return TIMEOUT_EXIT_CODE
  if (run.exceededMaxBuffer || run.failure !== undefined) return 1
  // No code means a signal ended the command.
  return code ?? 1
}

function toOutput(
  run: CommandRun,
  code: number | null,
  encoding: ShellExecInput['encoding']
): ShellExecOutput<string | Buffer> {
  const stdout = Buffer.concat(run.stdout)
  const said = Buffer.concat(run.stderr)
  // A command that never started has no stderr of its own; say why.
  const stderr = said.length === 0 && run.failure ? Buffer.from(run.failure) : said
  const text = encoding !== 'buffer'
  return {
    exitCode: exitCodeOf(run, code),
    stdout: text ? stdout.toString('utf8') : stdout,
    stderr: text ? stderr.toString('utf8') : stderr,
    timedOut: run.timedOut,
    exceededMaxBuffer: run.exceededMaxBuffer,
  }
}

function timeOut(run: CommandRun): void {
  run.timedOut = true
  stopGroup(run.child)
}

/** Resolves once the command has ended and its output has closed, or it could not start. */
function finished(
  run: CommandRun,
  input: ShellExecInput
): Promise<ShellExecOutput<string | Buffer>> {
  const timeoutMs = input.timeoutMs ?? DEFAULT_TIMEOUT_MS
  const timer = timeoutMs > 0 ? setTimeout(() => timeOut(run), timeoutMs) : undefined
  return new Promise((resolve) => {
    let settled = false
    const settle = (code: number | null): void => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      running.delete(run.child)
      resolve(toOutput(run, code, input.encoding))
    }
    run.child.once('error', (error) => {
      run.failure = error.message
      settle(null)
    })
    run.child.once('close', settle)
  })
}

export function execShell(
  input: ShellExecInput & { encoding: 'buffer' }
): Promise<ShellExecOutput<Buffer>>
export function execShell(input: ShellExecInput): Promise<ShellExecOutput>
export async function execShell(input: ShellExecInput): Promise<ShellExecOutput<string | Buffer>> {
  // The PATH is read at spawn time, after the login shell's has been adopted.
  await loginShellPathReady()
  return finished(startCommand(input, baseEnvironment()), input)
}

/**
 * Runs a command the way execShell does, stopped by stopRunningCommands too,
 * but in `environment` as given and without waiting for the login-shell PATH:
 * the core's own git (src/main/git/git-service.ts). Output is text.
 */
export async function runCommand(
  input: Omit<ShellExecInput, 'encoding'>,
  environment: NodeJS.ProcessEnv
): Promise<ShellExecOutput> {
  const result = await finished(startCommand(input, environment), input)
  return { ...result, stdout: result.stdout.toString(), stderr: result.stderr.toString() }
}
