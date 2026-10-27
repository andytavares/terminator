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
import { DESCRIPTION_MAX_LENGTH } from '../../shared/session-description.js'
import { deleteSessionContext } from '../integrations/session-context.js'
import { writeJsonAtomic } from '@terminator/extension-sdk/node'

const logger = makeLogger('session-record-store')
import { makeLogger } from '../logger.js'

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
  const before = new Set(records.keys())
  const kept = pruneRecords([...records.values()], Date.now())
  records.clear()
  for (const record of kept) records.set(record.sessionId, record)
  for (const id of before) {
    if (!records.has(id)) await deleteSessionContext(id)
  }
  await writeJsonAtomic(filePath(), kept)
}

const stringOrNull = (value: unknown): string | null => (typeof value === 'string' ? value : null)

/** The agent's id; a record from before agent tabs names `provider: 'claude'` instead. */
function agentIdOf(a: { agentId?: unknown; provider?: unknown }): string | null {
  if (typeof a.agentId === 'string' && a.agentId !== '') return a.agentId
  return a.provider === 'claude' ? 'claude' : null
}

/** A terminal conversation always has its transcript; an agent tab may have none. */
function transcriptOf(a: Partial<AgentConversation>, transport: string): string | null | undefined {
  if (typeof a.transcriptPath === 'string') return a.transcriptPath
  return transport === 'acp' && a.transcriptPath === null ? null : undefined
}

function transportOf(a: Partial<AgentConversation>): AgentConversation['transport'] | null {
  const transport = a.transport ?? 'tui'
  return transport === 'tui' || transport === 'acp' ? transport : null
}

function agentOf(value: unknown): AgentConversation | null {
  if (typeof value !== 'object' || value === null) return null
  const a = value as Partial<AgentConversation>
  const agentId = agentIdOf(a)
  const transport = transportOf(a)
  // A conversation this version cannot place loses its conversation, not the record.
  if (agentId === null || transport === null) return null
  const transcriptPath = transcriptOf(a, transport)
  const placed = typeof a.sessionId === 'string' && a.sessionId !== '' && typeof a.cwd === 'string'
  if (!placed || transcriptPath === undefined) return null
  return {
    agentId,
    transport,
    sessionId: a.sessionId as string,
    transcriptPath,
    cwd: a.cwd as string,
    capturedAt: typeof a.capturedAt === 'string' ? a.capturedAt : new Date().toISOString(),
  }
}

function linkOf(value: unknown): WorkItemRef | null {
  if (typeof value !== 'object' || value === null) return null
  const link = value as Partial<WorkItemRef>
  if (link.tracker !== 'linear') return null
  if (typeof link.key !== 'string' || link.key === '') return null
  return { tracker: link.tracker, key: link.key }
}

/** The stored entries, or none when the file is missing, unreadable or not a list. */
async function readStoredEntries(): Promise<unknown[]> {
  try {
    const parsed: unknown = JSON.parse(await fs.readFile(filePath(), 'utf8'))
    return Array.isArray(parsed) ? parsed : []
  } catch {
    // Missing or unreadable means no history, never a failed startup.
    return []
  }
}

/** One stored entry as a record, or null when it lacks what identifies one. */
function parseStoredRecord(entry: unknown): SessionRecord | null {
  if (typeof entry !== 'object' || entry === null) return null
  const r = entry as Partial<SessionRecord>
  if (typeof r.sessionId !== 'string' || typeof r.projectId !== 'string') return null
  if (typeof r.startedAt !== 'string' || typeof r.updatedAt !== 'string') return null
  return {
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
  }
}

/** Read what was stored. Called once at startup; safe to call again. */
export async function loadRecords(): Promise<void> {
  records.clear()
  const loaded = (await readStoredEntries())
    .map(parseStoredRecord)
    .filter((record): record is SessionRecord => record !== null)
  const kept = pruneRecords(loaded, Date.now())
  for (const record of kept) records.set(record.sessionId, record)
  const keptIds = new Set(kept.map((r) => r.sessionId))
  for (const record of loaded) {
    if (!keptIds.has(record.sessionId)) await deleteSessionContext(record.sessionId)
  }
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

type RecordPatch = Pick<Partial<SessionRecord>, 'description' | 'link' | 'agent'>

/** The patched fields, each kept from the existing record when the patch leaves it out. */
function patchedFields(
  existing: SessionRecord | undefined,
  patch: RecordPatch
): Pick<SessionRecord, 'description' | 'link' | 'agent'> {
  return {
    description: 'description' in patch ? patch.description! : (existing?.description ?? null),
    link: 'link' in patch ? patch.link! : (existing?.link ?? null),
    agent: 'agent' in patch ? patch.agent! : (existing?.agent ?? null),
  }
}

async function write(session: SessionSnapshot, patch: RecordPatch): Promise<SessionRecord | null> {
  const existing = records.get(session.sessionId)
  if (existing?.closedAt !== undefined) {
    throw new SessionRecordError('RECORD_CLOSED', 'This session has closed')
  }
  const fields = patchedFields(existing, patch)
  const empty = fields.description === null && fields.link === null && fields.agent === null
  if (empty && existing === undefined) return null

  const record: SessionRecord | null = empty
    ? null
    : { ...session, ...fields, updatedAt: new Date().toISOString() }
  if (record === null) records.delete(session.sessionId)
  else records.set(session.sessionId, record)
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

// Stamps a session's close time, once. Never rejects: callers close a terminal
// without waiting, so a failed write is logged instead.
export async function markClosed(sessionId: string, at: Date): Promise<void> {
  const existing = records.get(sessionId)
  if (existing === undefined || existing.closedAt !== undefined) return
  records.set(sessionId, { ...existing, closedAt: at.toISOString() })
  try {
    await persist()
    await deleteSessionContext(sessionId)
  } catch (error) {
    logger.error('could not save a closed session record', { sessionId, error: String(error) })
  }
  announce(sessionId)
}

/**
 * Drop a closed session's record for good.
 *
 * Only a closed one: a live session's record is what Home draws it from, and
 * forgetting it while the terminal runs would make the session disappear from
 * the list it is running in. Everything a record holds — the description, the
 * link, the conversation — goes with it, which is what being asked to forget a
 * session means.
 */
export async function forget(sessionId: string): Promise<boolean> {
  const existing = records.get(sessionId)
  if (existing === undefined || existing.closedAt === undefined) return false
  records.delete(sessionId)
  await persist()
  await deleteSessionContext(sessionId)
  announce(sessionId)
  return true
}

export function onRecordChange(handler: RecordChangeHandler): () => void {
  handlers.add(handler)
  return () => {
    handlers.delete(handler)
  }
}
