import { z } from 'zod'
import type { Disposable, ExtensionAPI } from '../types/api'

export type * from '../types/api'
export type * from '../types/issues'
export type * from '../types/extensions'
export type * from '../types/github'

/** One invoke channel: its payload schema, the response to a payload the schema rejects, and how
 * to answer a valid one. The core registers its own channels in this shape, and so does
 * `api.ipc.registerHandler` (ADR 096). */
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

/** Payload of a channel that takes none: the desktop renderer sends nothing, the remote bridge
 * sends `{}` in its place. */
export const noPayload = z.union([z.undefined(), z.object({})])

/** Declares one channel so `run` gets its own schema's payload type. The registry holds channels
 * of every schema, so the returned spec takes the payload `dispatchChannel` parsed with it. */
export function defineChannel<S extends z.ZodType>(spec: ChannelSpec<S>): ChannelSpec {
  return { ...spec, run: (args) => spec.run(args) }
}

/** Answers one invoke of `spec`: parses the payload, returns the declared invalid response when
 * the schema rejects it, and otherwise runs the channel. */
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

/** The response to a payload a channel's schema rejects. */
export function validationError(error: z.ZodError): { error: string; message: string } {
  return { error: 'VALIDATION_ERROR', message: error.message }
}

/** `word` when `count` is one, else its plural (`word` + "s" unless `many` is given). */
export function plural(count: number, word: string, many = `${word}s`): string {
  return count === 1 ? word : many
}

/** Registers one channel: its name, the schema its payload is parsed with, and its handler. */
export type ChannelRegistrar = <S extends z.ZodType>(
  channel: string,
  schema: S,
  run: (args: z.infer<S>) => Promise<unknown> | unknown
) => void

/** What every channel of one registrar answers when its payload is rejected or its run throws. */
export interface ChannelAnswers {
  /** Defaults to `validationError`. */
  invalid?: ChannelSpec['invalid']
  /** Without it, a channel whose run throws rejects the invoke. */
  onError?: ChannelSpec['onError']
}

/** An extension's channel registrar: `handle` for the desktop only, `handleRemote` for the remote
 * browser client too, and `cleanup` to unregister them all on deactivate (ADR 096). */
export function createIpcRegistrar(
  api: ExtensionAPI,
  answers: ChannelAnswers = {}
): { handle: ChannelRegistrar; handleRemote: ChannelRegistrar; cleanup(): void } {
  const disposables: Disposable[] = []
  const { invalid = validationError, onError } = answers
  const registrarFor =
    (remoteAccessible: boolean): ChannelRegistrar =>
    (channel, schema, run) => {
      const spec = defineChannel({ channel, schema, invalid, run, onError })
      disposables.push(api.ipc.registerHandler(spec, { remoteAccessible }))
    }
  return {
    handle: registrarFor(false),
    handleRemote: registrarFor(true),
    cleanup: () => disposables.forEach((disposable) => disposable.dispose()),
  }
}
