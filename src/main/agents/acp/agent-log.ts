import { appendFileSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync } from 'node:fs'
import { join } from 'node:path'
import type { AgentUpdate } from '@terminator/extension-sdk'

export interface AgentLog {
  append(sessionId: string, update: AgentUpdate): void
  /** The updates of a session in the order they arrived; empty when it has none. */
  readHistory(sessionId: string): AgentUpdate[]
  /** Deletes every log nothing was written to within `maxAgeMs`. */
  prune(maxAgeMs: number): void
}

/** The update a line holds; none for an empty line or one half written when the app stopped. */
function updateOf(line: string): AgentUpdate[] {
  try {
    return [(JSON.parse(line) as { update: AgentUpdate }).update]
  } catch {
    return []
  }
}

/** One JSON line `{ at, update }` per update, in `<directory>/<sessionId>.jsonl`. */
export function createAgentLog({
  directory,
  now,
}: {
  directory: string
  now: () => number
}): AgentLog {
  const fileOf = (sessionId: string): string =>
    join(directory, `${encodeURIComponent(sessionId)}.jsonl`)
  return {
    append(sessionId, update) {
      mkdirSync(directory, { recursive: true })
      appendFileSync(fileOf(sessionId), `${JSON.stringify({ at: now(), update })}\n`)
    },
    readHistory: (sessionId) => readLines(fileOf(sessionId)).flatMap(updateOf),
    prune(maxAgeMs) {
      const oldest = now() - maxAgeMs
      for (const file of logFilesIn(directory)) {
        if (lastWritten(file) < oldest) rmSync(file, { force: true })
      }
    },
  }
}

/** When the file was last written; never for one that cannot be read, so it is left alone. */
function lastWritten(file: string): number {
  try {
    return statSync(file).mtimeMs
  } catch {
    return Infinity
  }
}

/** The file's lines; none when it does not exist. */
function readLines(file: string): string[] {
  try {
    return readFileSync(file, 'utf8').split('\n')
  } catch {
    return []
  }
}

function logFilesIn(directory: string): string[] {
  try {
    return readdirSync(directory)
      .filter((name) => name.endsWith('.jsonl'))
      .map((name) => join(directory, name))
  } catch {
    return [] // No folder yet: nothing was ever logged.
  }
}
