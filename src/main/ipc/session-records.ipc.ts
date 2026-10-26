import type { BrowserWindow } from 'electron'
import { defineChannel, validationError, type ChannelSpec } from '@terminator/extension-sdk'
import { failureOf, registerInvokeTable, noPayload } from './invoke-table.js'
import { sendToWindow } from '../safe-send.js'
import * as fs from 'node:fs'
import {
  ForgetInputSchema,
  SetDescriptionInputSchema,
  SetLinkInputSchema,
  TransferInputSchema,
} from '../../shared/schemas/session-records.schema.js'
import { pruneRecords } from '../../shared/session-records/retention.js'
import {
  forget,
  listRecords,
  onRecordChange,
  setDescription,
  setLink,
  transfer,
} from '../sessions/session-record-store.js'
import { syncSessionContext } from '../integrations/session-context.js'
import { getIssueService } from '../integrations/index.js'
import type { SessionRecord, SessionRecordListing } from '../../shared/types/index.js'

// Core-only. Not part of the Extension API: a session's description is the
// operator's note to themself, and no extension has a reason to read it.

/**
 * Whether the conversation can be brought back on this machine right now.
 *
 * The transcript belongs to the agent, not to this application: it can be
 * deleted behind our back, and a record carried to another machine names one
 * that was never here. Reading the file system is the only honest answer, and
 * it is what stops Resume being offered where it would fail.
 */
function listing(record: SessionRecord | null): SessionRecordListing | null {
  if (record === null) return null
  const transcript = record.agent?.transcriptPath
  // An agent with no transcript of its own cannot be checked, so it is offered.
  const resumable = record.agent != null && (transcript == null || fs.existsSync(transcript))
  return { ...record, resumable }
}

/** Closed newest first, then the open ones, which have no close time to order by. */
function byCloseTime(a: { closedAt?: string }, b: { closedAt?: string }): number {
  if (a.closedAt === undefined) return b.closedAt === undefined ? 0 : 1
  if (b.closedAt === undefined) return -1
  return Date.parse(b.closedAt) - Date.parse(a.closedAt)
}

const recordReadChannels: ChannelSpec[] = [
  defineChannel({
    channel: 'session-records:list',
    schema: noPayload,
    invalid: validationError,
    run: () => ({
      data: pruneRecords(listRecords(), Date.now())
        .sort(byCloseTime)
        .map((record) => listing(record)!),
    }),
  }),
]

const recordWriteChannels: ChannelSpec[] = [
  defineChannel({
    channel: 'session-records:set-description',
    schema: SetDescriptionInputSchema,
    invalid: validationError,
    run: async ({ session, description }) => ({
      data: listing(await setDescription(session, description)),
    }),
    onError: failureOf,
  }),
  defineChannel({
    channel: 'session-records:set-link',
    schema: SetLinkInputSchema,
    invalid: validationError,
    run: async ({ session, link }) => {
      const record = await setLink(session, link)
      // The session's own link feeds its agent's SessionStart context and wins over the project's.
      // Best-effort: a tracker outage keeps whatever context was there rather than costing the
      // operator the link (syncSessionContext handles that itself).
      await syncSessionContext(session.sessionId, getIssueService())
      return { data: listing(record) }
    },
    onError: failureOf,
  }),
  defineChannel({
    channel: 'session-records:forget',
    schema: ForgetInputSchema,
    invalid: validationError,
    run: async ({ sessionId }) => ({ data: await forget(sessionId) }),
    onError: failureOf,
  }),
  defineChannel({
    channel: 'session-records:transfer',
    schema: TransferInputSchema,
    invalid: validationError,
    run: async ({ fromSessionId, session }) => ({
      data: listing(await transfer(fromSessionId, session)),
    }),
    onError: failureOf,
  }),
]

export function registerSessionRecordsHandlers(getWindow: () => BrowserWindow | null): void {
  registerInvokeTable([...recordReadChannels, ...recordWriteChannels])

  onRecordChange((sessionId, record) => {
    sendToWindow(getWindow(), 'session-records:changed', { sessionId, record: listing(record) })
  })
}
