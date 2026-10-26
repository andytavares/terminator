/** What the ask hook writes for one terminal: a Notification, a Stop or a UserPromptSubmit from its agent. */
export interface AskReport {
  /** The terminal the agent is running in — this application's own session id. */
  terminal: string
  event: 'notification' | 'stop' | 'prompt'
  message: string
  notificationType: string | null
  at: string
}

/** What an agent is waiting to be told, and since when. */
export interface AgentAsk {
  message: string
  since: string
}

/** What a report does to the terminal's ask: raise it, lift it, or nothing. */
export type AskChange = { kind: 'set'; ask: AgentAsk } | { kind: 'clear' } | { kind: 'ignore' }

// Types: https://code.claude.com/docs/en/hooks (Notification). Elicitation answered: question gone.
const ANSWERED_TYPES: readonly string[] = ['elicitation_complete', 'elicitation_response']
// idle_prompt and agent_completed mean done (Stop covers it); auth_success is news. Unknown asks.
const NOT_AN_ASK: readonly string[] = ['idle_prompt', 'agent_completed', 'auth_success']

const text = (value: unknown): string | null =>
  typeof value === 'string' && value.length > 0 ? value : null

/** A report, or nothing for anything that is not one. */
export function parseAskReport(value: unknown): AskReport | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null
  const raw = value as Record<string, unknown>
  const terminal = text(raw.terminal)
  if (terminal === null) return null
  if (raw.event !== 'notification' && raw.event !== 'stop' && raw.event !== 'prompt') return null
  return {
    terminal,
    event: raw.event,
    message: typeof raw.message === 'string' ? raw.message : '',
    notificationType: text(raw.notificationType),
    at: text(raw.at) ?? new Date().toISOString(),
  }
}

export function askChangeOf(report: AskReport): AskChange {
  if (report.event === 'stop' || report.event === 'prompt') return { kind: 'clear' }
  const type = report.notificationType
  if (type !== null && ANSWERED_TYPES.includes(type)) return { kind: 'clear' }
  if (type !== null && NOT_AN_ASK.includes(type)) return { kind: 'ignore' }
  return { kind: 'set', ask: { message: report.message, since: report.at } }
}

/** Whether the agent is in a turn after this report: a prompt starts one, a stop ends it, a notification leaves it as it is. */
export function turnChangeOf(report: AskReport): boolean | null {
  if (report.event === 'prompt') return true
  return report.event === 'stop' ? false : null
}

// xterm reports focus gaining and losing as these, with no one typing.
const FOCUS_REPORTS: readonly string[] = ['\x1b[I', '\x1b[O']

/** Whether input is only the terminal reporting its focus, which answers nothing. */
export function isFocusReport(data: string): boolean {
  return FOCUS_REPORTS.includes(data)
}
