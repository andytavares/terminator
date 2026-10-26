/** What the capture hook writes for one terminal, once its agent has reported a conversation. */
export interface HookReport {
  /** The terminal the agent is running in — this application's own session id. */
  terminal: string
  provider: 'claude'
  sessionId: string
  transcriptPath: string
  cwd: string
  /** What the agent called it: a fresh start, a resume, or something this version has not met. */
  source: string
  at: string
}

const PROVIDERS: readonly string[] = ['claude']

const text = (value: unknown): string | null =>
  typeof value === 'string' && value.length > 0 ? value : null

/**
 * A report, or nothing.
 *
 * Nothing is the common case for a conversation this application cannot place:
 * one in a terminal it does not own, or from an agent whose conversations it
 * cannot resume. Both are ordinary, so neither is an error.
 */
export function parseHookReport(value: unknown): HookReport | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null
  const raw = value as Record<string, unknown>
  const where = conversationLocation(raw)
  const provider = text(raw.provider)
  if (where === null || provider === null || !PROVIDERS.includes(provider)) return null

  return {
    ...where,
    provider: 'claude',
    source: text(raw.source) ?? 'unknown',
    at: text(raw.at) ?? new Date().toISOString(),
  }
}

type ConversationLocation = Pick<HookReport, 'terminal' | 'sessionId' | 'transcriptPath' | 'cwd'>

/** The four fields that place a conversation, or null when any is missing. */
function conversationLocation(raw: Record<string, unknown>): ConversationLocation | null {
  const terminal = text(raw.terminal)
  const sessionId = text(raw.sessionId)
  const transcriptPath = text(raw.transcriptPath)
  const cwd = text(raw.cwd)
  if (terminal === null || sessionId === null || transcriptPath === null || cwd === null)
    return null
  return { terminal, sessionId, transcriptPath, cwd }
}
