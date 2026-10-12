import { z } from 'zod'

export type * from '../types/api'
export type * from '../types/issues'
export type * from '../types/extensions'
export type * from '../types/github'

/**
 * One invoke channel: its payload schema, the response to a payload the
 * schema rejects, and how to answer a valid one. The core registers its own
 * channels in this shape, and so does `api.ipc.registerHandler` (ADR 096).
 */
export interface ChannelSpec<S extends z.ZodType = z.ZodType> {
  channel: string
  schema: S
  /** Response returned when the payload fails validation. */
  invalid: unknown | ((error: z.ZodError) => unknown)
  /** Produces the success response from the validated payload. */
  run: (args: z.infer<S>) => Promise<unknown> | unknown
  /** Response when run() throws. Omit to let the error propagate. */
  onError?: (e: unknown) => unknown
}

/**
 * Payload of a channel that takes none: the desktop renderer sends nothing,
 * the remote bridge sends `{}` in its place.
 */
export const noPayload = z.union([z.undefined(), z.object({})])

/** Identity helper so each channel infers its own schema's payload type. */
export function defineChannel<S extends z.ZodType>(spec: ChannelSpec<S>): ChannelSpec {
  return spec as unknown as ChannelSpec
}

/**
 * Answers one invoke of `spec`: parses the payload, returns the declared
 * invalid response when the schema rejects it, and otherwise runs the channel.
 */
export async function dispatchChannel(spec: ChannelSpec, payload: unknown): Promise<unknown> {
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
}
