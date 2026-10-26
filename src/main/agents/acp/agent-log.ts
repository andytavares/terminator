import { appendFileSync, mkdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { AgentUpdate } from '@terminator/extension-sdk'

export interface AgentLog {
  append(sessionId: string, update: AgentUpdate): void
  /** The updates of a session in the order they arrived; empty when it has none. */
  readHistory(sessionId: string): AgentUpdate[]
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
    readHistory(sessionId) {
      let text: string
      try {
        text = readFileSync(fileOf(sessionId), 'utf8')
      } catch {
        return []
      }
      return text.split('\n').flatMap(updateOf)
    },
  }
}
