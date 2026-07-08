import { ELECTRON_API_MANIFEST, type ChannelSpec } from './manifest.js'

// Generates a window.electronAPI object from the channel manifest for one
// transport. The manifest declares the interface once; the transport supplies
// how invoke/send/subscribe reach the main process, and `locals` supplies the
// implementations for 'local' specs and (on remote) 'stub' specs.

export interface ApiTransport {
  invoke(channel: string, payload?: unknown): Promise<unknown>
  send(channel: string, payload?: unknown): void
  /** Subscribes to a main→renderer push channel; listener receives the wire args. */
  subscribe(channel: string, listener: (args: unknown[]) => void): () => void
}

export interface BuildApiOptions {
  mode: 'native' | 'remote'
  /**
   * Implementations keyed by spec path for kind 'local' specs, and — in remote
   * mode — for specs with remote: 'stub'. Missing entries throw at build time
   * so an incomplete adapter fails on startup, not at first call.
   */
  locals?: Record<string, (...args: never[]) => unknown>
}

function methodFor(
  spec: ChannelSpec,
  transport: ApiTransport,
  opts: BuildApiOptions
): ((...args: unknown[]) => unknown) | undefined {
  const remote = spec.remote ?? 'same'
  const needsLocal = spec.kind === 'local' || (opts.mode === 'remote' && remote === 'stub')

  if (opts.mode === 'remote' && remote === 'omit') return undefined

  if (needsLocal) {
    const local = opts.locals?.[spec.path]
    if (!local) {
      throw new Error(`electronAPI builder: missing local implementation for '${spec.path}'`)
    }
    return local as (...args: unknown[]) => unknown
  }

  const channel = spec.channel
  if (!channel) {
    throw new Error(`electronAPI builder: spec '${spec.path}' has no channel`)
  }

  switch (spec.kind) {
    case 'invoke':
      return (...args: unknown[]) =>
        transport.invoke(channel, spec.toPayload ? spec.toPayload(...(args as never[])) : args[0])
    case 'send':
      return (...args: unknown[]) =>
        transport.send(channel, spec.toPayload ? spec.toPayload(...(args as never[])) : args[0])
    case 'event':
      return (...args: unknown[]) => {
        const handler = args[0] as (...handlerArgs: unknown[]) => void
        return transport.subscribe(channel, (wireArgs) =>
          handler(...(spec.toHandlerArgs ? spec.toHandlerArgs(wireArgs) : wireArgs))
        )
      }
  }
}

export function buildElectronApi(
  transport: ApiTransport,
  opts: BuildApiOptions
): Record<string, unknown> {
  const api: Record<string, unknown> = {}
  for (const spec of ELECTRON_API_MANIFEST) {
    const method = methodFor(spec, transport, opts)
    if (!method) continue
    const segments = spec.path.split('.')
    let target = api
    for (const segment of segments.slice(0, -1)) {
      target = (target[segment] ??= {}) as Record<string, unknown>
    }
    target[segments[segments.length - 1]] = method
  }
  return api
}
