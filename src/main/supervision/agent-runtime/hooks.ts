import type { SessionEvent } from '../events/session-event.js'
import { hookToSessionEvent } from './to-session-event.js'

// Lifecycle hooks, the supplementary observation source. Two things make them
// worth registering at all:
//
//   - SessionStart carries `transcript_path`, which is how the tailer learns
//     where the durable record lives without computing a path (research.md R3).
//   - PreToolUse / PostToolUse give the matched pair that lets the stall
//     detector exclude an in-flight shell command (FR-015).
//
// These callbacks observe. They never block, never deny, and never fail a run:
// a supervision fault must not take down the session it is watching.

const OBSERVED_EVENTS = ['SessionStart', 'PreToolUse', 'PostToolUse'] as const

export interface SupervisionHooksOptions {
  publish: (event: SessionEvent) => void
  now: () => number
}

type HookCallback = (input: unknown) => Promise<{ continue: true }>

export type SupervisionHooks = Record<string, Array<{ hooks: HookCallback[] }>>

export function buildSupervisionHooks(options: SupervisionHooksOptions): SupervisionHooks {
  const { publish, now } = options

  const callback: HookCallback = async (input: unknown) => {
    try {
      const event = hookToSessionEvent(input, now())
      if (event !== null) publish(event)
    } catch {
      // Observation is best-effort. The transcript tailer is the durable
      // source, so a dropped hook event costs latency, not correctness.
    }
    return { continue: true }
  }

  return Object.fromEntries(
    OBSERVED_EVENTS.map((eventName) => [eventName, [{ hooks: [callback] }]])
  )
}
