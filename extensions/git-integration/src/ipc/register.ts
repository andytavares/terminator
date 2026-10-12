import type { ChannelSpec } from '@terminator/extension-sdk'

// Every channel declares the schema its payload is parsed with before `run`
// sees it (ADR 096); `activate` decides whether the remote browser may call it.

/** Registers one channel. */
export type RegisterFn = (spec: ChannelSpec) => void

/** What a channel answers to a payload its schema rejects. */
export const VALIDATION_ERROR = { error: 'VALIDATION_ERROR' }

/** The `{ error }` envelope of a thrown error, as the views read it. */
export const errorEnvelope = (e: unknown) => ({ error: String(e) })

/** Wraps a channel registrar so each run logs its channel and duration. */
export function withTiming(register: RegisterFn): RegisterFn {
  return (spec) =>
    register({
      ...spec,
      run: (args) => {
        const start = performance.now()
        const elapsed = () => Math.round(performance.now() - start)
        const done = () => console.debug(`[git-integration] ${spec.channel} ${elapsed()}ms`)
        const result = spec.run(args)
        if (result instanceof Promise) return result.finally(done)
        done()
        return result
      },
    })
}
