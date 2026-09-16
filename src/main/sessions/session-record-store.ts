import * as fs from 'node:fs/promises'
import * as path from 'node:path'
import { app } from 'electron'
import type {
  AgentConversation,
  SessionRecord,
  SessionSnapshot,
  WorkItemRef,
} from '../../shared/types/index.js'
import { pruneRecords } from '../../shared/session-records/retention.js'
import { DESCRIPTION_MAX_LENGTH } from '../../shared/schemas/session-records.schema.js'

// What the operator wrote about a session, and the ticket they pinned to it.
//
// Sessions themselves live only in the renderer and die with the app, which is
// exactly when their context would be lost. So the context is kept here, beside
// issue-link-store and in the same shape: held in memory for synchronous
// readers, mirrored to disk with a tmp-then-rename write.

const FILE_NAME = 'session-records.json'

type RecordChangeHandler = (sessionId: string, record: SessionRecord | null) => void

class SessionRecordError extends Error {
  constructor(
    readonly code: 'VALIDATION_ERROR' | 'RECORD_CLOSED',
    message: string
  ) {
    super(message)
  }
}

const records = new Map<string, SessionRecord>()
const handlers = new Set<RecordChangeHandler>()

function filePath(): string {
  return path.join(app.getPath('userData'), FILE_NAME)
}

function announce(sessionId: string): void {
  const record = records.get(sessionId) ?? null
  for (const handler of handlers) handler(sessionId, record)
}

async function persist(): Promise<void> {
  const kept = pruneRecords([...records.values()], Date.now())
  records.clear()
  for (const record of kept) records.set(record.sessionId, record)
  const target = filePath()
  const tmp = `${target}.tmp`
  await fs.writeFile(tmp, JSON.stringify(kept, null, 2), 'utf8')
  await fs.rename(tmp, target)
}

const stringOrNull = (value: unknown): string | null => (typeof value === 'string' ? value : null)

function agentOf(value: unknown): AgentConversation | null {
  if (typeof value !== 'object' || value === null) return null
  const a = value as Partial<AgentConversation>
  // An agent this version cannot resume loses its conversation, not the record.
  if (a.provider !== 'claude') return null
  if (typeof a.sessionId !== 'string' || a.sessionId === '') return null
  if (typeof a.transcriptPath !== 'string' || typeof a.cwd !== 'string') return null
  return {
    provider: 'claude',
    sessionId: a.sessionId,
    transcriptPath: a.transcriptPath,
    cwd: a.cwd,
    capturedAt: typeof a.capturedAt === 'string' ? a.capturedAt : new Date().toISOString(),
  }
}

function linkOf(value: unknown): WorkItemRef | null {
  if (typeof value !== 'object' || value === null) return null
  const link = value as Partial<WorkItemRef>
  if (link.tracker !== 'linear' && link.tracker !== 'jira') return null
  if (typeof link.key !== 'string' || link.key === '') return null
  return { tracker: link.tracker, key: link.key }
}

/** Read what was stored. Called once at startup; safe to call again. */
export async function loadRecords(): Promise<void> {
  records.clear()
  let parsed: unknown
  try {
    parsed = JSON.parse(await fs.readFile(filePath(), 'utf8'))
  } catch {
    // Missing or unreadable means no history, never a failed startup.
    return
  }
  if (!Array.isArray(parsed)) return
  const loaded: SessionRecord[] = []
  for (const entry of parsed) {
    if (typeof entry !== 'object' || entry === null) continue
    const r = entry as Partial<SessionRecord>
    if (typeof r.sessionId !== 'string' || typeof r.projectId !== 'string') continue
    if (typeof r.startedAt !== 'string' || typeof r.updatedAt !== 'string') continue
    loaded.push({
      sessionId: r.sessionId,
      projectId: r.projectId,
      workspaceName: stringOrNull(r.workspaceName),
      projectName: stringOrNull(r.projectName),
      branch: stringOrNull(r.branch),
      tabTitle: typeof r.tabTitle === 'string' ? r.tabTitle : '',
      shell: stringOrNull(r.shell),
      description: stringOrNull(r.description),
      link: linkOf(r.link),
      agent: agentOf(r.agent),
      startedAt: r.startedAt,
      updatedAt: r.updatedAt,
      ...(typeof r.closedAt === 'string' ? { closedAt: r.closedAt } : {}),
    })
  }
  for (const record of pruneRecords(loaded, Date.now())) records.set(record.sessionId, record)
}

/**
 * Close whatever the last run left open.
 *
 * No session survives a restart, and a quit does not close its terminals one by
 * one, so a record still open at startup belonged to a session that ended when
 * the app did. Its last update is the last moment it was known to be alive.
 */
export async function sweepOpenRecords(): Promise<void> {
  const open = [...records.values()].filter((r) => r.closedAt === undefined)
  if (open.length === 0) return
  for (const record of open)
    records.set(record.sessionId, { ...record, closedAt: record.updatedAt })
  await persist()
  for (const record of open) announce(record.sessionId)
}

export function listRecords(): SessionRecord[] {
  return [...records.values()]
}

async function write(
  session: SessionSnapshot,
  patch: Pick<Partial<SessionRecord>, 'description' | 'link' | 'agent'>
): Promise<SessionRecord | null> {
  const existing = records.get(session.sessionId)
  if (existing?.closedAt !== undefined) {
    throw new SessionRecordError('RECORD_CLOSED', 'This session has closed')
  }
  const description = 'description' in patch ? patch.description! : (existing?.description ?? null)
  const link = 'link' in patch ? patch.link! : (existing?.link ?? null)
  const agent = 'agent' in patch ? patch.agent! : (existing?.agent ?? null)

  if (description === null && link === null && agent === null) {
    if (existing === undefined) return null
    records.delete(session.sessionId)
    await persist()
    announce(session.sessionId)
    return null
  }

  const record: SessionRecord = {
    ...session,
    description,
    link,
    agent,
    updatedAt: new Date().toISOString(),
  }
  records.set(session.sessionId, record)
  await persist()
  announce(session.sessionId)
  return record
}

/** Set or clear a session's description. Blank clears. */
export async function setDescription(
  session: SessionSnapshot,
  description: string | null
): Promise<SessionRecord | null> {
  const trimmed = description?.trim() ?? ''
  if (trimmed.length > DESCRIPTION_MAX_LENGTH) {
    throw new SessionRecordError(
      'VALIDATION_ERROR',
      `A description is at most ${DESCRIPTION_MAX_LENGTH} characters`
    )
  }
  return write(session, { description: trimmed === '' ? null : trimmed })
}

/** Set or remove a session's own work item. The project's link is never touched. */
export async function setLink(
  session: SessionSnapshot,
  link: WorkItemRef | null
): Promise<SessionRecord | null> {
  return write(session, { link })
}

/**
 * Record the agent conversation running in a session, or forget it.
 *
 * A conversation is context in its own right: a session with nothing but one
 * still gets a record, because that is what Resume reads after a restart.
 */
export async function setAgent(
  session: SessionSnapshot,
  agent: AgentConversation | null
): Promise<SessionRecord | null> {
  return write(session, { agent })
}

/**
 * Move one session's context onto another, in a single write.
 *
 * Resuming ends with the conversation in a new terminal; its description, link
 * and conversation belong there now. Two writes could half-fail and leave the
 * same context on both.
 */
export async function transfer(
  fromSessionId: string,
  session: SessionSnapshot
): Promise<SessionRecord | null> {
  const existing = records.get(fromSessionId)
  if (existing === undefined) return null

  records.delete(fromSessionId)
  const record: SessionRecord = {
    ...session,
    description: existing.description,
    link: existing.link,
    agent: existing.agent,
    updatedAt: new Date().toISOString(),
  }
  records.set(session.sessionId, record)
  await persist()
  announce(fromSessionId)
  announce(session.sessionId)
  return record
}

/** Stamp a session's close time, once. A session without a record has nothing to keep. */
export async function markClosed(sessionId: string, at: Date): Promise<void> {
  const existing = records.get(sessionId)
  if (existing === undefined || existing.closedAt !== undefined) return
  records.set(sessionId, { ...existing, closedAt: at.toISOString() })
  await persist()
  announce(sessionId)
}

export function onRecordChange(handler: RecordChangeHandler): () => void {
  handlers.add(handler)
  return () => {
    handlers.delete(handler)
  }
}
