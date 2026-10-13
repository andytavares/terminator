import { delimiter } from 'path'
import { runCommand } from './command-runner.js'

const MARK = '__TERMINATOR_PATH__'

/**
 * Put the user's login-shell PATH ahead of the app's own.
 *
 * macOS starts an app from the Dock or Finder with PATH=/usr/bin:/bin:/usr/sbin:/sbin,
 * so anything installed by Homebrew — `gh` above all — cannot be spawned, and
 * spawns fail with ENOENT. `-i` as well as `-l` because PATH is commonly set in
 * an interactive rc file (.zshrc), which a login-only shell does not read. The
 * rc file may print, so only the value between the markers is taken. Any
 * failure keeps the PATH the app already has. Run through runCommand, so the
 * timeout, or the app quitting, also stops what the rc files started.
 * @internal
 */
export async function adoptLoginShellPath(env: NodeJS.ProcessEnv = process.env): Promise<void> {
  if (!env.SHELL) return
  const probe = await runCommand(
    {
      command: env.SHELL,
      args: ['-ilc', `printf '${MARK}%s${MARK}' "$PATH"`],
      cwd: process.cwd(),
      timeoutMs: 5000,
    },
    { ...env, DISABLE_AUTO_UPDATE: 'true' }
  )
  if (probe.exitCode !== 0) return
  const loginPath = probe.stdout.split(MARK)[1]
  if (!loginPath) return
  const entries = [...loginPath.split(delimiter), ...(env.PATH ?? '').split(delimiter)]
  env.PATH = [...new Set(entries.filter(Boolean))].join(delimiter)
}

let loginShellPath: Promise<void> = Promise.resolve()

/** Starts reading the login-shell PATH and remembers the read, so a spawn made while the window
 * is already open can wait for it (`loginShellPathReady`). */
export function startAdoptingLoginShellPath(env: NodeJS.ProcessEnv = process.env): Promise<void> {
  loginShellPath = adoptLoginShellPath(env)
  return loginShellPath
}

export function loginShellPathReady(): Promise<void> {
  return loginShellPath
}
