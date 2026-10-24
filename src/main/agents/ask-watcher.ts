import * as fs from 'node:fs'
import * as path from 'node:path'
import {
  askChangeOf,
  isFocusReport,
  parseAskReport,
  turnChangeOf,
  type AgentAsk,
} from '../../shared/agent-sessions/ask.js'
import { endTurn, setTurn } from './agent-turns.js'
import { asksDirectory } from './agent-ask-hook.js'
import { probeUntilArmed } from './agent-session-watcher.js'
import { makeLogger } from '../logger.js'

// One file per terminal, claimed by rename before it is read (as agent-session-watcher does).
// The ask lives in main because both the hook and the keystrokes arrive here.

export type AskListener = (sessionId: string, ask: AgentAsk | null) => void

const logger = makeLogger('ask-watcher')
const asks = new Map<string, AgentAsk>()
const listeners = new Set<AskListener>()

export function onAskChange(listener: AskListener): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

function announce(sessionId: string, ask: AgentAsk | null): void {
  for (const listener of listeners) listener(sessionId, ask)
}

/** Every terminal that has an ask now, for a window that opens after one was raised. */
export function currentAsks(): Array<{ sessionId: string; ask: AgentAsk }> {
  return [...asks].map(([sessionId, ask]) => ({ sessionId, ask }))
}

/** The operator typed to the terminal, which answers whatever was asked. */
export function clearAsk(sessionId: string): void {
  if (asks.delete(sessionId)) announce(sessionId, null)
}

// Claude Code's interrupt keys. An interrupted turn sends no Stop hook
// (https://code.claude.com/docs/en/hooks#stop), so the key itself ends it.
const INTERRUPT_KEYS: readonly string[] = ['\x1b', '\x03']

/** Input answers the ask (unless it is only a focus report); Esc or Ctrl+C also ends the turn. */
export function noteTerminalInput(sessionId: string, data: string): void {
  if (isFocusReport(data)) return
  clearAsk(sessionId)
  if (INTERRUPT_KEYS.includes(data)) endTurn(sessionId)
}

function applyAskReport(file: string): void {
  const claimed = `${file}.claimed`
  try {
    fs.renameSync(file, claimed)
  } catch {
    return // Already handled by an earlier event.
  }
  try {
    const report = parseAskReport(JSON.parse(fs.readFileSync(claimed, 'utf8')))
    if (report === null) return
    const inTurn = turnChangeOf(report)
    if (inTurn !== null) setTurn(report.terminal, inTurn)
    const change = askChangeOf(report)
    if (change.kind === 'set') {
      asks.set(report.terminal, change.ask)
      announce(report.terminal, change.ask)
    } else if (change.kind === 'clear') clearAsk(report.terminal)
  } catch {
    // Not a report, or unreadable: nothing to record.
  } finally {
    fs.rmSync(claimed, { recursive: true, force: true })
  }
}

function applyDirectory(directory: string): void {
  let names: string[]
  try {
    names = fs.readdirSync(directory)
  } catch {
    return
  }
  for (const name of names) if (name.endsWith('.json')) applyAskReport(path.join(directory, name))
}

/** Watches for asks (`fs.watch`, ADR-005) and returns the way to stop. Any event re-reads the
 * directory; the first one, which proves the watch is armed, also picks up what arrived before it. */
export function startAskWatcher(): () => void {
  const directory = asksDirectory()
  fs.mkdirSync(directory, { recursive: true })
  // A file left by a previous run describes a question nobody is waiting on any more.
  for (const name of fs.readdirSync(directory))
    fs.rmSync(path.join(directory, name), { force: true })
  let armed = false
  let stopArmingProbe = (): void => undefined
  const watcher = fs.watch(directory, () => {
    armed = true
    stopArmingProbe()
    applyDirectory(directory)
  })
  watcher.on('error', (error) => logger.error('ask watch failed', { error: String(error) }))
  stopArmingProbe = probeUntilArmed(directory, () => armed)
  return () => {
    stopArmingProbe()
    watcher.close()
  }
}
