import { runProcess, type ShellExecInput, type ShellExecOutput } from './command-runner.js'
import { loginShellPathReady } from './login-shell-path.js'
import { isPathWithin } from '../fs/path-within.js'
import { realpath } from 'fs/promises'
import { basename, dirname, isAbsolute, join } from 'path'

export type { ShellExecInput, ShellExecOutput } from './command-runner.js'

/** The only commands any caller may run; the shell:exec channel's schema is built from it. */
export const ALLOWED_COMMAND_NAMES = ['git', 'gh'] as const
const ALLOWED_COMMANDS = new Set<string>(ALLOWED_COMMAND_NAMES)

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

/** Refuses a `cwd` that is not one of `roots` or below one (ADR 102). Both sides are compared
 * after realpath, so a symlink inside a root cannot lead out of it. */
export async function assertCwdInScope(cwd: string, roots: readonly string[]): Promise<void> {
  if (!isAbsolute(cwd)) throw new CwdOutOfScopeError(cwd)
  const real = await realPathOf(cwd)
  const realRoots = await Promise.all(roots.filter((root) => isAbsolute(root)).map(realPathOf))
  if (!realRoots.some((root) => isPathWithin(real, root))) throw new CwdOutOfScopeError(cwd)
}

/** The real path of `target`, or of its nearest existing ancestor with the rest appended: a
 * directory not created yet (a clone target) is still somewhere. */
async function realPathOf(target: string): Promise<string> {
  try {
    return await realpath(target)
  } catch {
    return join(await realPathOf(dirname(target)), basename(target))
  }
}

/** A path-segment check: `/a/bc` is not within `/a/b`. */
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

export function execShell(
  input: ShellExecInput & { encoding: 'buffer' }
): Promise<ShellExecOutput<Buffer>>
export function execShell(input: ShellExecInput): Promise<ShellExecOutput>
export async function execShell(input: ShellExecInput): Promise<ShellExecOutput<string | Buffer>> {
  // The PATH is read at spawn time, after the login shell's has been adopted.
  await loginShellPathReady()
  return runProcess(input, baseEnvironment())
}
