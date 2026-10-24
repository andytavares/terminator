import * as fs from 'node:fs/promises'
import * as path from 'node:path'
import { shellQuote } from '@terminator/extension-sdk/node'
import { putHook } from '../integrations/claude-settings.js'
import { reportDirectory, userSettingsPath, type CaptureHookOptions } from './agent-session-hook.js'

// Claude Code runs Notification hooks when it needs an answer, UserPromptSubmit hooks when a turn
// starts and Stop hooks when it ends (payloads: https://code.claude.com/docs/en/hooks). One script
// writes each event to its own asks/<time>-<pid>.json, so two events in a row are both seen.

const SCRIPT_NAME = 'agent-ask-hook.cjs'
const ASKS_DIR_NAME = 'asks'

/** The script the agent runs on Notification, UserPromptSubmit and Stop; silent on error like CAPTURE_SCRIPT.
 * @internal */
export const ASK_SCRIPT = `// Written by Terminator. Do not edit: it is overwritten on every start.
const fs = require('fs')
const path = require('path')

const [reportDir] = process.argv.slice(2)
const terminal = process.env.TERMINATOR_SESSION_ID

let raw = ''
process.stdin.setEncoding('utf8')
process.stdin.on('data', (chunk) => {
  raw += chunk
})
process.stdin.on('end', () => {
  try {
    if (!terminal || !reportDir) return
    const payload = JSON.parse(raw)
    if (!payload || typeof payload !== 'object') return
    const events = { Notification: 'notification', Stop: 'stop', StopFailure: 'stop', UserPromptSubmit: 'prompt' }
    const event = events[payload.hook_event_name]
    if (!event) return

    const directory = path.join(reportDir, ${JSON.stringify(ASKS_DIR_NAME)})
    fs.mkdirSync(directory, { recursive: true })
    const report = {
      terminal,
      event,
      message: typeof payload.message === 'string' ? payload.message : '',
      notificationType: typeof payload.notification_type === 'string' ? payload.notification_type : null,
      at: new Date().toISOString(),
    }
    const target = path.join(directory, Date.now() + '-' + process.pid + '.json')
    fs.writeFileSync(target + '.tmp', JSON.stringify(report), 'utf8')
    fs.renameSync(target + '.tmp', target)
  } catch {
    // Intentionally silent: an unseen question is a missed badge; a failing hook breaks a session.
  } finally {
    process.exit(0)
  }
})
`

/** Where the ask hook writes, and the ask watcher reads. */
export function asksDirectory(): string {
  return path.join(reportDirectory(), ASKS_DIR_NAME)
}

/** Write the ask script and return its absolute path. */
export async function installAskScript(directory: string): Promise<string> {
  await fs.mkdir(directory, { recursive: true })
  const target = path.join(directory, SCRIPT_NAME)
  await fs.writeFile(target, ASK_SCRIPT, 'utf8')
  return target
}

function askCommand(options: CaptureHookOptions): string {
  const run = [
    'ELECTRON_RUN_AS_NODE=1',
    shellQuote(options.execPath),
    shellQuote(options.scriptPath),
    shellQuote(reportDirectory()),
  ].join(' ')
  // Claude settings are global: skip outside a Terminator terminal, and when the script is gone
  // (this entry outlives any install of the application). Always exits 0.
  return `[ -n "$TERMINATOR_SESSION_ID" ] && test -f ${shellQuote(options.scriptPath)} && ${run} || true`
}

/** Registers the Notification, UserPromptSubmit, Stop and StopFailure entries in the operator's Claude settings, ours alone. */
export async function installAskHooks(options: CaptureHookOptions): Promise<void> {
  const command = askCommand(options)
  const ours = { marker: SCRIPT_NAME, command }
  await putHook(userSettingsPath(), 'Notification', ours)
  await putHook(userSettingsPath(), 'UserPromptSubmit', ours)
  await putHook(userSettingsPath(), 'Stop', ours)
  await putHook(userSettingsPath(), 'StopFailure', ours)
}
