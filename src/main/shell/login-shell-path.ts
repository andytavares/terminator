import { execFile } from 'child_process'
import { delimiter } from 'path'
import { promisify } from 'util'

const execFileAsync = promisify(execFile)

const MARK = '__TERMINATOR_PATH__'

/**
 * Put the user's login-shell PATH ahead of the app's own.
 *
 * macOS starts an app from the Dock or Finder with PATH=/usr/bin:/bin:/usr/sbin:/sbin,
 * so anything installed by Homebrew — `gh` above all — cannot be spawned, and
 * spawns fail with ENOENT. `-i` as well as `-l` because PATH is commonly set in
 * an interactive rc file (.zshrc), which a login-only shell does not read. The
 * rc file may print, so only the value between the markers is taken. Any
 * failure keeps the PATH the app already has.
 */
export async function adoptLoginShellPath(env: NodeJS.ProcessEnv = process.env): Promise<void> {
  if (!env.SHELL) return
  let stdout: string
  try {
    ;({ stdout } = await execFileAsync(env.SHELL, ['-ilc', `printf '${MARK}%s${MARK}' "$PATH"`], {
      encoding: 'utf8',
      timeout: 5000,
      env: { ...env, DISABLE_AUTO_UPDATE: 'true' },
    }))
  } catch {
    return
  }
  const loginPath = stdout.split(MARK)[1]
  if (!loginPath) return
  const entries = [...loginPath.split(delimiter), ...(env.PATH ?? '').split(delimiter)]
  env.PATH = [...new Set(entries.filter(Boolean))].join(delimiter)
}
