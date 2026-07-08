import type { z } from 'zod'
import { handleChannel } from './channel-registrar.js'

// Schema-driven registration for validated invoke channels. Each row declares
// the channel, its payload schema, the response for invalid payloads, and how
// to produce the success (and optionally failure) response. The
// parse → dispatch → error-envelope skeleton lives here, once.

export interface InvokeSpec<S extends z.ZodType = z.ZodType> {
  channel: string
  schema: S
  /** Response returned when the payload fails validation. */
  invalid: unknown | ((error: z.ZodError) => unknown)
  /** Produces the success response from the validated payload. */
  run: (args: z.infer<S>) => Promise<unknown> | unknown
  /** Response when run() throws. Omit to let the error propagate. */
  onError?: (e: unknown) => unknown
}

/** Identity helper so each table row infers its own schema's payload type. */
export function invokeSpec<S extends z.ZodType>(spec: InvokeSpec<S>): InvokeSpec {
  return spec as unknown as InvokeSpec
}

export function registerInvokeTable(specs: ReadonlyArray<InvokeSpec>): void {
  for (const spec of specs) {
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
