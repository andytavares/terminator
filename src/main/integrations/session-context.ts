import * as fs from 'node:fs/promises'
import * as path from 'node:path'
import { app } from 'electron'
import type { AgentContext } from '../../shared/types/index.js'
import { buildAgentContext } from './agent-context.js'
import type { IssueService } from './issue-service.js'
import { listRecords } from '../sessions/session-record-store.js'
import { writeJsonAtomic } from '@terminator/extension-sdk/node'

// A session's own link, kept in step with what its agent is told.
//
// The project link feeds every session in that project; a session's own link
// is more specific and wins over it (session-hook.ts checks for this file
// before falling back to the project's). One file per session, addressed by
// session id so it cannot collide with another terminal's.

function sessionContextDir(): string {
  return path.join(app.getPath('userData'), 'integrations', 'session-context')
}

/** Exported so the hook command builder can point at the same directory. */
export function sessionContextDirectory(): string {
  return sessionContextDir()
}

function sessionContextFilePath(sessionId: string): string {
  return path.join(sessionContextDir(), `${sessionId}.json`)
}

/** @internal */
export async function writeSessionContext(sessionId: string, context: AgentContext): Promise<void> {
  await fs.mkdir(sessionContextDir(), { recursive: true })
  await writeJsonAtomic(sessionContextFilePath(sessionId), context)
}

export async function deleteSessionContext(sessionId: string): Promise<void> {
  await fs.rm(sessionContextFilePath(sessionId), { force: true })
}

/**
 * Bring a session's own agent context up to date with its own link.
 *
 * Called on setLink. A tracker that is unreachable right now must not cost
 * the operator their link — the previous context file stays until a
 * successful read replaces it, same as the project's own sync.
 */
export async function syncSessionContext(
  sessionId: string,
  service: IssueService
): Promise<AgentContext | null> {
  const record = listRecords().find((r) => r.sessionId === sessionId)

  if (!record?.link) {
    await deleteSessionContext(sessionId)
    return null
  }

  const { link } = record
  const issue = await service.get(link.tracker, link.key).catch(() => null)
  const context = buildAgentContext(record.projectId, issue)
  if (context === null) return null

  await writeSessionContext(sessionId, context)
  return context
}
