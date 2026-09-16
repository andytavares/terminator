import type { AgentProvider } from '../types/index.js'

/** What the capture hook writes for one terminal, once its agent has reported a conversation. */
export interface HookReport {
  /** The terminal the agent is running in — this application's own session id. */
  terminal: string
  provider: AgentProvider
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

  const terminal = text(raw.terminal)
  const sessionId = text(raw.sessionId)
  const transcriptPath = text(raw.transcriptPath)
  const cwd = text(raw.cwd)
  const provider = text(raw.provider)
  if (terminal === null || sessionId === null || transcriptPath === null || cwd === null)
    return null
  if (provider === null || !PROVIDERS.includes(provider)) return null

  return {
    terminal,
    provider: provider as AgentProvider,
    sessionId,
    transcriptPath,
    cwd,
    source: text(raw.source) ?? 'unknown',
    at: text(raw.at) ?? new Date().toISOString(),
  }
}
