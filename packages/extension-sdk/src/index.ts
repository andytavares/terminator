import type { z } from 'zod'

export type * from '../types/api'
export type * from '../types/issues'
export type * from '../types/extensions'

/**
 * One invoke channel: its payload schema, the response to a payload the
 * schema rejects, and how to answer a valid one. The core registers its own
 * channels in this shape (ADR 096).
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

/** Identity helper so each channel infers its own schema's payload type. */
export function defineChannel<S extends z.ZodType>(spec: ChannelSpec<S>): ChannelSpec {
  return spec as unknown as ChannelSpec
}
