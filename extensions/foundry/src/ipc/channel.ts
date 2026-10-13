import type { z } from 'zod'
import { defineChannel, type ChannelSpec } from '@terminator/extension-sdk'

/** What a Foundry channel answers to a payload its schema rejects. */
const MALFORMED_REQUEST = { error: 'Malformed request.' }

/**
 * One Foundry channel: the host parses the payload with `schema` before `run`
 * sees it, and answers a rejected one with `MALFORMED_REQUEST` (ADR 096).
 */
export function foundryChannel<S extends z.ZodType>(
  channel: string,
  schema: S,
  run: (payload: z.infer<S>) => Promise<unknown> | unknown
): ChannelSpec {
  return defineChannel({ channel, schema, invalid: MALFORMED_REQUEST, run })
}

/** What a supervised-session channel answers to a payload its schema rejects: nothing was done. */
const NOT_DONE = { ok: false }

/** A channel that acts on a supervised session and answers `{ ok }`, `NOT_DONE` when rejected. */
export function sessionChannel<S extends z.ZodType>(
  channel: string,
  schema: S,
  run: (payload: z.infer<S>) => Promise<unknown> | unknown
): ChannelSpec {
  return defineChannel({ channel, schema, invalid: NOT_DONE, run })
}
