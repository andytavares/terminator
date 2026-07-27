import { createJsonlLog } from '../storage/jsonl-log.js'

// The chronological account of what happened while the operator was away
// (FR-091 – FR-093).
//
// Authorship is explicit and load-bearing: an entry the console wrote — a stall
// notice, most importantly — must never read as though the agent said it
// (FR-092). The operator has to be able to tell "the agent told me it was
// stuck" from "nobody told me anything and Terminator noticed".

export type FeedAuthor = 'agent' | 'console'

export interface FeedEntry {
  readonly id: string
  readonly at: number
  readonly sessionId: string
  readonly author: FeedAuthor
  readonly summary: string
  /** Only an agent-authored entry can be replied to — the console is not listening. */
  readonly replyable: boolean
}

export interface MuteRule {
  readonly sessionId?: string
  readonly author?: FeedAuthor
}

export interface FeedLog {
  post(entry: Omit<FeedEntry, 'id' | 'replyable'>): FeedEntry
  list(): FeedEntry[]
  since(at: number): FeedEntry[]
  forSession(sessionId: string): FeedEntry[]
  /** Whether an entry should raise a notification, or only appear in the feed (FR-029). */
  shouldNotify(entry: FeedEntry, mutes: readonly MuteRule[]): boolean
}

export function createFeedLog(path: string): FeedLog {
  const log = createJsonlLog<FeedEntry>(path)
  let counter = 0

  return {
    post(entry): FeedEntry {
      const full: FeedEntry = {
        ...entry,
        id: `${entry.sessionId}-${entry.at}-${++counter}`,
        // Replying to a console entry would go nowhere; the agent wrote none of it.
        replyable: entry.author === 'agent',
      }
      log.append(full)
      return full
    },

    list(): FeedEntry[] {
      return log.readAll().sort((a, b) => a.at - b.at)
    },

    since(at: number): FeedEntry[] {
      return log.readRange((entry) => entry.at >= at).sort((a, b) => a.at - b.at)
    },

    forSession(sessionId: string): FeedEntry[] {
      return log.readRange((entry) => entry.sessionId === sessionId).sort((a, b) => a.at - b.at)
    },

    shouldNotify(entry: FeedEntry, mutes: readonly MuteRule[]): boolean {
      // Muting suppresses the notification, never the entry: the record of what
      // happened stays complete whether or not it interrupted anyone (FR-029).
      return !mutes.some(
        (rule) =>
          (rule.sessionId === undefined || rule.sessionId === entry.sessionId) &&
          (rule.author === undefined || rule.author === entry.author)
      )
    },
  }
}
