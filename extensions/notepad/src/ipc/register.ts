import { z } from 'zod'
import { createIpcRegistrar } from '@terminator/extension-sdk'
import type { ExtensionAPI } from '@terminator/extension-sdk'

/** What every notepad channel answers to a payload its schema rejects. */
export const VALIDATION_ERROR = { error: 'VALIDATION_ERROR' }

/** Payload of a channel that acts on one row, named by its id. */
export const IdPayload = z.object({ id: z.string() })

/** Notepad's channel registrar: every channel answers a rejected payload with VALIDATION_ERROR.
 * A channel is local-only unless it registers through `handleRemote`. */
export function notepadChannels(api: ExtensionAPI): ReturnType<typeof createIpcRegistrar> {
  return createIpcRegistrar(api, { invalid: VALIDATION_ERROR })
}
