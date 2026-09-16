import type { BrowserWindow } from 'electron'
import { registerInvokeTable, invokeSpec } from './invoke-table.js'
import { handleChannel } from './channel-registrar.js'
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
import type { SessionRecord, SessionRecordListing } from '../../shared/types/index.js'

// Core-only. Not part of the Extension API: a session's description is the
// operator's note to themself, and no extension has a reason to read it.

function fail(error: unknown): { error: string; message: string } {
  const code = (error as { code?: unknown }).code
  return {
    error: typeof code === 'string' ? code : 'failed',
    message: error instanceof Error ? error.message : String(error),
  }
}

function invalid(error: { message: string }): { error: string; message: string } {
  return { error: 'VALIDATION_ERROR', message: error.message }
}

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
  const resumable = record.agent !== null && fs.existsSync(record.agent.transcriptPath)
  return { ...record, resumable }
}

/** Closed newest first, then the open ones, which have no close time to order by. */
function byCloseTime(a: { closedAt?: string }, b: { closedAt?: string }): number {
  if (a.closedAt === undefined) return b.closedAt === undefined ? 0 : 1
  if (b.closedAt === undefined) return -1
  return Date.parse(b.closedAt) - Date.parse(a.closedAt)
}

export function registerSessionRecordsHandlers(
  getWindow: () => BrowserWindow | null = () => null
): void {
  handleChannel('session-records:list', () => ({
    data: pruneRecords(listRecords(), Date.now())
      .sort(byCloseTime)
      .map((record) => listing(record)!),
  }))

  registerInvokeTable([
    invokeSpec({
      channel: 'session-records:set-description',
      schema: SetDescriptionInputSchema,
      invalid,
      run: async ({ session, description }) => ({
        data: listing(await setDescription(session, description)),
      }),
      onError: fail,
    }),
    invokeSpec({
      channel: 'session-records:set-link',
      schema: SetLinkInputSchema,
      invalid,
      run: async ({ session, link }) => ({ data: listing(await setLink(session, link)) }),
      onError: fail,
    }),
    invokeSpec({
      channel: 'session-records:forget',
      schema: ForgetInputSchema,
      invalid,
      run: async ({ sessionId }) => ({ data: await forget(sessionId) }),
      onError: fail,
    }),
    invokeSpec({
      channel: 'session-records:transfer',
      schema: TransferInputSchema,
      invalid,
      run: async ({ fromSessionId, session }) => ({
        data: listing(await transfer(fromSessionId, session)),
      }),
      onError: fail,
    }),
  ])

  onRecordChange((sessionId, record) => {
    sendToWindow(getWindow(), 'session-records:changed', { sessionId, record: listing(record) })
  })
}
