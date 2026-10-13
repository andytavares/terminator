import { createJsonlLog, type JsonlLog } from '../jsonl-log.js'

// The chronological account of what happened while the operator was away
// (FR-091 – FR-093).
//
// Authorship is explicit and load-bearing: an entry the console wrote — a stall
// notice, most importantly — must never read as though the agent said it
// (FR-092). The operator has to be able to tell "the agent told me it was
// stuck" from "nobody told me anything and Terminator noticed".

type FeedAuthor = 'agent' | 'console'

interface FeedEntry {
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

/**
 * How many entries the feed keeps.
 *
 * It is a record of what happened while you were away, not an archive: every
 * read parses the whole file, and tombstones append rather than removing, so
 * without a bound both the file and the cost of reading it grow for the life of
 * the workspace.
 */
const MAX_ENTRIES = 2_000

/**
 * How often to check.
 *
 * Compacting on every post would re-read and rewrite the file for each line
 * written. The feed therefore sits at up to `MAX_ENTRIES + COMPACT_EVERY`
 * between checks, which is the bound — not `MAX_ENTRIES` exactly.
 */
const COMPACT_EVERY = 200

/** One feed's file, who is told when it moves, and its counters. */
interface FeedState {
  readonly log: JsonlLog<FeedRow>
  readonly onChange: () => void
  /** How many entries this process has posted, which numbers each one. */
  posted: number
  sinceCompaction: number
}

/** `onChange` is told after every write, so a window can read the feed when it moves. */
export function createFeedLog(path: string, onChange: () => void = () => {}): FeedLog {
  const state: FeedState = {
    log: createJsonlLog<FeedRow>(path),
    onChange,
    posted: 0,
    sinceCompaction: 0,
  }
  const { log } = state
  return {
    post: (entry) => post(state, entry),
    list: () => liveEntries(log.readAll()).sort((a, b) => a.at - b.at),
    forget(sessionId: string): void {
      // Append-only, like every other record here: a tombstone rather than a
      // rewrite, so a crash costs the last line and not the feed.
      log.append({ forgotten: sessionId })
      onChange()
    },
    removeEntry(id: string): void {
      log.append({ dropped: id })
      onChange()
    },
    shouldNotify,
  }
}

function post(state: FeedState, entry: Omit<FeedEntry, 'id' | 'replyable'>): FeedEntry {
  // Rewritten from what survives, occasionally: the tombstones for
  // forgotten sessions and dropped entries are only meaningful until the
  // rows they hide are gone.
  if (++state.sinceCompaction >= COMPACT_EVERY) {
    state.sinceCompaction = 0
    const surviving = liveEntries(state.log.readAll())
    if (surviving.length > MAX_ENTRIES) {
      state.log.rewrite(surviving.slice(-MAX_ENTRIES))
    }
  }
  const full: FeedEntry = {
    ...entry,
    id: `${entry.sessionId}-${entry.at}-${++state.posted}`,
    // Replying to a console entry would go nowhere; the agent wrote none of it.
    replyable: entry.author === 'agent',
  }
  state.log.append(full)
  state.onChange()
  return full
}

/** What survives: entries about sessions nothing has forgotten since. */
function liveEntries(rows: readonly FeedRow[]): FeedEntry[] {
  const entries: FeedEntry[] = []
  for (const row of rows) {
    if (isDropped(row)) {
      const index = entries.findIndex((entry) => entry.id === row.dropped)
      if (index !== -1) entries.splice(index, 1)
    } else if (isForgotten(row)) {
      forgetSession(entries, row.forgotten)
    } else {
      entries.push(row)
    }
  }
  return entries
}

/**
 * A session can be forgotten and then, in principle, seen again — so this
 * drops what came before rather than filtering the whole file.
 */
function forgetSession(entries: FeedEntry[], sessionId: string): void {
  for (let index = entries.length - 1; index >= 0; index--) {
    if (entries[index].sessionId === sessionId) entries.splice(index, 1)
  }
}

function shouldNotify(entry: FeedEntry, mutes: readonly MuteRule[]): boolean {
  // Muting suppresses the notification, never the entry: the record of what
  // happened stays complete whether or not it interrupted anyone (FR-029).
  return !mutes.some(
    (rule) =>
      (rule.sessionId === undefined || rule.sessionId === entry.sessionId) &&
      (rule.author === undefined || rule.author === entry.author)
  )
}
