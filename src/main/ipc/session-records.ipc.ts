import type { BrowserWindow } from 'electron'
import { registerInvokeTable, invokeSpec } from './invoke-table.js'
import { handleChannel } from './channel-registrar.js'
import { sendToWindow } from '../safe-send.js'
import {
  SetDescriptionInputSchema,
  SetLinkInputSchema,
} from '../../shared/schemas/session-records.schema.js'
import { pruneRecords } from '../../shared/session-records/retention.js'
import {
  listRecords,
  onRecordChange,
  setDescription,
  setLink,
} from '../sessions/session-record-store.js'

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
    data: pruneRecords(listRecords(), Date.now()).sort(byCloseTime),
  }))

  registerInvokeTable([
    invokeSpec({
      channel: 'session-records:set-description',
      schema: SetDescriptionInputSchema,
      invalid,
      run: async ({ session, description }) => ({
        data: await setDescription(session, description),
      }),
      onError: fail,
    }),
    invokeSpec({
      channel: 'session-records:set-link',
      schema: SetLinkInputSchema,
      invalid,
      run: async ({ session, link }) => ({ data: await setLink(session, link) }),
      onError: fail,
    }),
  ])

  onRecordChange((sessionId, record) => {
    sendToWindow(getWindow(), 'session-records:changed', { sessionId, record })
  })
}
