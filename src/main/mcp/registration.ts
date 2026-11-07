import * as fs from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'
import { app } from 'electron'
import { runsInBackground } from '../background-mode.js'
import { logger } from '../logger.js'
import { userSettingsPath } from '../agents/claude-hook.js'
import { putAllowRule } from '../integrations/claude-settings.js'
import { runTextCommand } from '../shell/command-runner.js'
import { loginShellPathReady } from '../shell/login-shell-path.js'

// Registers the relay with Claude Code at user scope (ADR 145), so every session, started by
// Terminator or not, can reach the Terminator MCP server.

const STATE_FILE_NAME = 'registered.json'

/** Runs `claude` with `args`. */
export type ClaudeRun = (args: string[]) => Promise<{ exitCode: number; stderr: string }>

export interface RegistrationOptions {
  relayPath: string
  socketPath: string
  /** Where the last registration is remembered. */
  directory: string
  settingsFile?: string
  run?: ClaudeRun
}

// `claude` is found on the login-shell PATH: a Dock launch has only /usr/bin:/bin.
const runClaude: ClaudeRun = async (args) => {
  await loginShellPathReady()
  const result = await runTextCommand(
    { command: 'claude', args, cwd: os.homedir(), timeoutMs: 30_000 },
    process.env
  )
  return { exitCode: result.didNotRun ? 127 : result.exitCode, stderr: result.stderr }
}

/** Never throws for a missing or failing `claude`: it logs, and tries again on the next start. */
export async function registerWithClaude(options: RegistrationOptions): Promise<void> {
  if (runsInBackground()) return
  const name = app.isPackaged ? 'terminator' : 'terminator-dev'
  const run = options.run ?? runClaude
  await putAllowRule(options.settingsFile ?? userSettingsPath(), `mcp__${name}`)
  const config = JSON.stringify({
    type: 'stdio',
    command: process.execPath,
    args: [options.relayPath, options.socketPath],
    env: { ELECTRON_RUN_AS_NODE: '1' },
  })
  const stateFile = path.join(options.directory, STATE_FILE_NAME)
  const registered = JSON.stringify({ name, config })
  if ((await fs.readFile(stateFile, 'utf8').catch(() => null)) === registered) return
  // add-json refuses a name that exists; the old entry may not, so its failure is expected.
  await run(['mcp', 'remove', '--scope', 'user', name])
  const added = await run(['mcp', 'add-json', '--scope', 'user', name, config])
  if (added.exitCode !== 0) {
    logger.warn('could not register the Terminator MCP server', { stderr: added.stderr })
    return
  }
  await fs.mkdir(options.directory, { recursive: true })
  await fs.writeFile(stateFile, registered, 'utf8')
}
