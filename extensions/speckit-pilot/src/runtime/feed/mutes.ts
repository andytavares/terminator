import * as fs from 'node:fs'
import * as path from 'node:path'
import type { MuteRule } from './feed-log.js'

// Which runs are allowed to interrupt you.
//
// Muting suppresses the notification, never the entry: the feed's record of
// what happened stays complete whether or not it interrupted anyone. That
// distinction is the whole point — a run you have stopped wanting toasts about
// is not a run you have stopped wanting a record of.
//
// Persisted, because a mute you have to set again after every restart is one
// you stop bothering with, and then the notifications get turned off wholesale.

export interface MuteStore {
  list(): MuteRule[]
  /** Adds a rule, ignoring one that would be a duplicate. */
  add(rule: MuteRule): void
  remove(rule: MuteRule): void
  clear(): void
}

function key(rule: MuteRule): string {
  return `${rule.sessionId ?? '*'}:${rule.author ?? '*'}`
}

export function createMuteStore(filePath: string): MuteStore {
  function read(): MuteRule[] {
    try {
      const parsed: unknown = JSON.parse(fs.readFileSync(filePath, 'utf8'))
      if (!Array.isArray(parsed)) return []
      // Filtered on read rather than trusted: the file is small, hand-editable,
      // and a malformed rule would silently mute everything or nothing.
      return parsed.filter(
        (rule): rule is MuteRule =>
          typeof rule === 'object' &&
          rule !== null &&
          (rule as MuteRule).sessionId !== null &&
          ((rule as MuteRule).author === undefined ||
            (rule as MuteRule).author === 'agent' ||
            (rule as MuteRule).author === 'console')
      )
    } catch {
      return []
    }
  }

  function write(rules: readonly MuteRule[]): void {
    try {
      fs.mkdirSync(path.dirname(filePath), { recursive: true })
      fs.writeFileSync(filePath, JSON.stringify(rules), 'utf8')
    } catch {
      // A mute that could not be saved still applies for this session; failing
      // the click over it would be worse than losing it on restart.
    }
  }

  return {
    list: read,

    add(rule): void {
      const rules = read()
      if (rules.some((existing) => key(existing) === key(rule))) return
      write([...rules, rule])
    },

    remove(rule): void {
      write(read().filter((existing) => key(existing) !== key(rule)))
    },

    clear(): void {
      write([])
    },
  }
}
