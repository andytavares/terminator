import { createJsonlLog } from '../jsonl-log.js'

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
  /**
   * Drops everything said about a session. Discarding one, or reclaiming its
   * working copy, leaves nothing to go back to — so its entries in the feed
   * are noise about something that no longer exists.
   */
  forget(sessionId: string): void
  /** Removes one entry. Anything shown as a list should be prunable. */
  removeEntry(id: string): void
  /** Whether an entry should raise a notification, or only appear in the feed (FR-029). */
  shouldNotify(entry: FeedEntry, mutes: readonly MuteRule[]): boolean
}

/** A tombstone: everything said about this session is gone. */
interface ForgottenRow {
  readonly forgotten: string
}

/** A tombstone for a single entry rather than a whole session. */
interface DroppedRow {
  readonly dropped: string
}

function isForgotten(row: FeedRow): row is ForgottenRow {
  return typeof (row as ForgottenRow).forgotten === 'string'
}

function isDropped(row: FeedRow): row is DroppedRow {
  return typeof (row as DroppedRow).dropped === 'string'
}

type FeedRow = FeedEntry | ForgottenRow | DroppedRow

export function createFeedLog(path: string): FeedLog {
  const log = createJsonlLog<FeedRow>(path)
  let counter = 0

  /** What survives: entries about sessions nothing has forgotten since. */
  function live(): FeedEntry[] {
    const entries: FeedEntry[] = []
    for (const row of log.readAll()) {
      if (isDropped(row)) {
        const index = entries.findIndex((entry) => entry.id === row.dropped)
        if (index !== -1) entries.splice(index, 1)
        continue
      }
      if (isForgotten(row)) {
        // A session can be forgotten and then, in principle, seen again — so
        // this drops what came before rather than filtering the whole file.
        for (let index = entries.length - 1; index >= 0; index--) {
          if (entries[index].sessionId === row.forgotten) entries.splice(index, 1)
        }
        continue
      }
      entries.push(row)
    }
    return entries
  }

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
      return live().sort((a, b) => a.at - b.at)
    },

    since(at: number): FeedEntry[] {
      return live()
        .filter((entry) => entry.at >= at)
        .sort((a, b) => a.at - b.at)
    },

    forSession(sessionId: string): FeedEntry[] {
      return live()
        .filter((entry) => entry.sessionId === sessionId)
        .sort((a, b) => a.at - b.at)
    },

    forget(sessionId: string): void {
      // Append-only, like every other record here: a tombstone rather than a
      // rewrite, so a crash costs the last line and not the feed.
      log.append({ forgotten: sessionId })
    },

    removeEntry(id: string): void {
      log.append({ dropped: id })
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
