import * as fs from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'
import { app } from 'electron'
import { shellQuote } from '@terminator/extension-sdk/node'
import type { TermctlStatus } from '../../../core-shared/src/electron-api/manifest.js'
import { runTextCommand } from '../shell/command-runner.js'

// Puts termctl on the PATH: a launcher in userData, written on every start (ADR-026), and a
// symlink to it in /usr/local/bin. The launcher runs termctl.mjs with the app's own Node.

const COMMAND_NAME = 'termctl'

export interface LauncherInput {
  execPath: string
  scriptPath: string
  socketPath: string
}

export interface TermctlOptions {
  launcherPath: string
  /** `/usr/local/bin`; specs pass a temp directory. */
  binDirectory: string
  /** Runs a shell line with an administrator's rights; specs pass a fake. */
  runAsAdministrator?: (shellLine: string) => Promise<void>
}

/** termctl.mjs: an extra resource when packaged, the termctl workspace's build in development. */
export function termctlScriptPath(): string {
  return app.isPackaged
    ? path.join(process.resourcesPath, 'termctl', 'termctl.mjs')
    : path.join(app.getAppPath(), 'apps', 'termctl', 'dist', 'termctl.mjs')
}

export function launcherScript(input: LauncherInput): string {
  return [
    '#!/bin/sh',
    '# Written by Terminator. Do not edit: it is overwritten on every start.',
    'export ELECTRON_RUN_AS_NODE=1',
    `export TERMINATOR_MCP_SOCKET=${shellQuote(input.socketPath)}`,
    `exec ${shellQuote(input.execPath)} ${shellQuote(input.scriptPath)} "$@"`,
    '',
  ].join('\n')
}

/** Write the launcher and return its absolute path. */
export async function writeLauncher(directory: string, input: LauncherInput): Promise<string> {
  await fs.mkdir(directory, { recursive: true })
  const target = path.join(directory, COMMAND_NAME)
  await fs.writeFile(target, launcherScript(input), 'utf8')
  await fs.chmod(target, 0o755)
  return target
}

/** The AppleScript that runs `shellLine` after macOS's administrator prompt. */
export function administratorScript(shellLine: string): string {
  const quoted = shellLine.replace(/[\\"]/g, (character) => `\\${character}`)
  return `do shell script "${quoted}" with administrator privileges`
}

const runWithAdministratorPrompt = async (shellLine: string): Promise<void> => {
  const result = await runTextCommand(
    { command: 'osascript', args: ['-e', administratorScript(shellLine)], cwd: os.homedir() },
    process.env
  )
  if (result.exitCode !== 0)
    throw new Error(result.stderr.trim() || 'The administrator prompt failed.')
}

const linkPathOf = (options: TermctlOptions) => path.join(options.binDirectory, COMMAND_NAME)

export async function termctlStatus(options: TermctlOptions): Promise<TermctlStatus> {
  const linkPath = linkPathOf(options)
  const found = await fs.lstat(linkPath).catch(() => null)
  if (found === null) return { state: 'not-installed', path: linkPath }
  const ours = found.isSymbolicLink() && (await fs.readlink(linkPath)) === options.launcherPath
  return { state: ours ? 'installed' : 'other', path: linkPath }
}

/** Runs `change`; without write access, runs `shellLine` after the administrator prompt instead. */
async function withAdministratorFallback(
  options: TermctlOptions,
  change: () => Promise<void>,
  shellLine: string
): Promise<void> {
  try {
    await change()
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EACCES') throw error
    await (options.runAsAdministrator ?? runWithAdministratorPrompt)(shellLine)
  }
}

/** Fails with EEXIST when another program's termctl is there: it is never replaced. */
export async function installTermctl(options: TermctlOptions): Promise<void> {
  const linkPath = linkPathOf(options)
  const link = async () => {
    await fs.mkdir(options.binDirectory, { recursive: true })
    await fs.symlink(options.launcherPath, linkPath)
  }
  const directory = shellQuote(options.binDirectory)
  const shellLine = `mkdir -p ${directory} && ln -s ${shellQuote(options.launcherPath)} ${shellQuote(linkPath)}`
  await withAdministratorFallback(options, link, shellLine)
}

/** Removes the link only when it points at our launcher. */
export async function uninstallTermctl(options: TermctlOptions): Promise<void> {
  if ((await termctlStatus(options)).state !== 'installed') return
  const linkPath = linkPathOf(options)
  await withAdministratorFallback(options, () => fs.unlink(linkPath), `rm ${shellQuote(linkPath)}`)
}
