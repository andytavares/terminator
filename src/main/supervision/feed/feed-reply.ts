import type { FeedLog } from './feed-log.js'

// FR-093. A reply typed into the feed reaches the session it belongs to.
//
// Only an agent-authored entry is replyable: the console wrote its own entries,
// so replying to one would go nowhere. The feed marks that on each entry and
// this enforces it rather than trusting the caller.

export interface ReplyResult {
  readonly ok: boolean
  readonly reason: string | null
}

export interface FeedReplyOptions {
  log: FeedLog
  /** Sends the operator's message into a running session. */
  sendToSession(sessionId: string, message: string): Promise<void>
  now: () => number
}

export function createFeedReply(options: FeedReplyOptions) {
  const { log, sendToSession, now } = options

  return {
    async reply(entryId: string, message: string): Promise<ReplyResult> {
      const trimmed = message.trim()
      if (trimmed === '') return { ok: false, reason: 'a reply cannot be empty' }

      const entry = log.list().find((candidate) => candidate.id === entryId)
      if (entry === undefined) return { ok: false, reason: 'no such feed entry' }
      if (!entry.replyable) {
        return { ok: false, reason: 'that entry was written by Terminator, not the agent' }
      }

      try {
        await sendToSession(entry.sessionId, trimmed)
      } catch (error) {
        // The session may have ended between rendering the feed and replying.
        return { ok: false, reason: error instanceof Error ? error.message : String(error) }
      }

      // Recorded as the operator's own turn in the account, so the feed stays a
      // complete record of the conversation rather than only the agent's half.
      log.post({
        at: now(),
        sessionId: entry.sessionId,
        author: 'console',
        summary: `You replied: ${trimmed}`,
      })

      return { ok: true, reason: null }
    },
  }
}
