import * as fs from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'
import { app } from 'electron'
import { runsInBackground } from '../background-mode.js'
import { logger } from '../logger.js'
import { userSettingsPath } from '../agents/claude-hook.js'
import { shellQuote } from '@terminator/extension-sdk/node'
import { putAllowRule, removeAllowRule } from '../integrations/claude-settings.js'
import type { ClaudeCodeStatus } from '../../../core-shared/src/electron-api/manifest.js'
import { runTextCommand } from '../shell/command-runner.js'
import { loginShellPathReady } from '../shell/login-shell-path.js'

// Registers the relay with Claude Code at user scope (ADR 145), so every session, started by
// Terminator or not, can reach the Terminator MCP server.

const STATE_FILE_NAME = 'registered.json'

/** @internal Runs `claude` with `args`; specs pass a fake. */
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

interface Registration {
  name: string
  config: string
}

/** What `registered.json` remembers: the last registration, and how it ended. */
interface RegistrationRecord extends Registration {
  state: ClaudeCodeStatus['state']
  reason?: string
}

/** The name Claude Code knows the server by; a dev build's never collides with the app's. */
export const mcpServerName = (): string => (app.isPackaged ? 'terminator' : 'terminator-dev')

function currentRegistration(options: RegistrationOptions): Registration {
  const name = mcpServerName()
  const config = JSON.stringify({
    type: 'stdio',
    command: process.execPath,
    args: [options.relayPath, options.socketPath],
    env: { ELECTRON_RUN_AS_NODE: '1' },
  })
  return { name, config }
}

const stateFile = (options: RegistrationOptions) => path.join(options.directory, STATE_FILE_NAME)
const settingsFileOf = (options: RegistrationOptions) => options.settingsFile ?? userSettingsPath()

async function readRecord(options: RegistrationOptions): Promise<RegistrationRecord | null> {
  const text = await fs.readFile(stateFile(options), 'utf8').catch(() => null)
  return text === null ? null : (JSON.parse(text) as RegistrationRecord)
}

async function writeRecord(options: RegistrationOptions, record: RegistrationRecord) {
  await fs.mkdir(options.directory, { recursive: true })
  await fs.writeFile(stateFile(options), JSON.stringify(record), 'utf8')
}

function registrationFailure(added: { exitCode: number; stderr: string }): string {
  if (added.exitCode === 127) {
    return 'Claude Code is not installed: Terminator cannot find the claude command.'
  }
  const said = added.stderr.trim() || `exit code ${added.exitCode}`
  return `Claude Code could not add the server: ${said}`
}

const sameRegistration = (record: RegistrationRecord | null, current: Registration) =>
  record?.name === current.name && record.config === current.config

/** Never throws for a missing or failing `claude`: it logs, and tries again on the next start.
 * Does nothing after the person disconnected, until they connect again. */
export async function registerWithClaude(options: RegistrationOptions): Promise<void> {
  if (runsInBackground()) return
  const current = currentRegistration(options)
  const record = await readRecord(options)
  if (record?.state === 'disconnected') return
  await putAllowRule(settingsFileOf(options), `mcp__${current.name}`)
  if (record?.state === 'connected' && sameRegistration(record, current)) return
  const run = options.run ?? runClaude
  // add-json refuses a name that exists; the old entry may not, so its failure is expected.
  await run(['mcp', 'remove', '--scope', 'user', current.name])
  const added = await run(['mcp', 'add-json', '--scope', 'user', current.name, current.config])
  if (added.exitCode !== 0) {
    logger.warn('could not register the Terminator MCP server', { stderr: added.stderr })
    await writeRecord(options, {
      ...current,
      state: 'unavailable',
      reason: registrationFailure(added),
    })
    return
  }
  await writeRecord(options, { ...current, state: 'connected' })
}

export async function registrationStatus(options: RegistrationOptions): Promise<ClaudeCodeStatus> {
  const current = currentRegistration(options)
  const record = await readRecord(options)
  const command = `claude mcp add-json --scope user ${current.name} ${shellQuote(current.config)}`
  const status = { name: current.name, command }
  if (record?.state === 'disconnected') return { ...status, state: 'disconnected' }
  if (record?.state === 'unavailable')
    return { ...status, state: 'unavailable', reason: record.reason }
  if (sameRegistration(record, current)) return { ...status, state: 'connected' }
  return { ...status, state: 'disconnected' }
}

/** Removes the server and its allow rule, and remembers it, so the next start leaves it removed. */
export async function disconnect(options: RegistrationOptions): Promise<void> {
  const current = currentRegistration(options)
  if (!runsInBackground()) {
    await (options.run ?? runClaude)(['mcp', 'remove', '--scope', 'user', current.name])
    await removeAllowRule(settingsFileOf(options), `mcp__${current.name}`)
  }
  await writeRecord(options, { ...current, state: 'disconnected' })
}

/** Forgets a disconnect or a failure, and registers again. */
export async function connect(options: RegistrationOptions): Promise<void> {
  await fs.rm(stateFile(options), { force: true })
  await registerWithClaude(options)
}
