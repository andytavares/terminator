import { z } from 'zod'
import type { ChannelSpec } from '@terminator/extension-sdk'
import { handleChannel } from './channel-registrar.js'

// Schema-driven registration for validated invoke channels. Each row declares
// the channel, its payload schema, the response for invalid payloads, and how
// to produce the success (and optionally failure) response. The
// parse → dispatch → error-envelope skeleton lives here, once.

/**
 * Payload of a channel that takes none: the desktop renderer sends nothing,
 * the remote bridge sends `{}` in its place.
 */
export const noPayload = z.union([z.undefined(), z.object({})])

const registeredSpecs = new Map<string, ChannelSpec>()

/** The table row a channel was registered from; undefined for a channel not registered here. */
export function registeredInvokeSpec(channel: string): ChannelSpec | undefined {
  return registeredSpecs.get(channel)
}

export function registerInvokeTable(specs: ReadonlyArray<ChannelSpec>): void {
  for (const spec of specs) {
    registeredSpecs.set(spec.channel, spec)
    handleChannel(spec.channel, async (_event, payload) => {
      const parsed = spec.schema.safeParse(payload)
      if (!parsed.success) {
        return typeof spec.invalid === 'function'
          ? (spec.invalid as (error: z.ZodError) => unknown)(parsed.error)
          : spec.invalid
      }
      try {
        return await spec.run(parsed.data)
      } catch (e) {
        if (spec.onError) return spec.onError(e)
        throw e
      }
    })
  }
}
