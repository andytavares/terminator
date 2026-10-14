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

// Specs for extension views only belong to src/main/preload-webview.ts.
function belongsToSurface(spec: ChannelSpec, mode: BuildApiOptions['mode']): boolean {
  if (spec.extensionView === 'only') return false
  return mode === 'native' || (spec.remote ?? 'same') !== 'omit'
}

type ApiMethod = (...args: unknown[]) => unknown

function methodFor(
  spec: ChannelSpec,
  transport: ApiTransport,
  opts: BuildApiOptions
): ApiMethod | undefined {
  if (!belongsToSurface(spec, opts.mode)) return undefined
  const needsLocal = spec.kind === 'local' || (opts.mode === 'remote' && spec.remote === 'stub')
  return needsLocal ? localMethod(spec, opts.locals) : transportMethod(spec, transport)
}

function localMethod(spec: ChannelSpec, locals: BuildApiOptions['locals']): ApiMethod {
  const local = locals?.[spec.path]
  if (!local) {
    throw new Error(`electronAPI builder: missing local implementation for '${spec.path}'`)
  }
  return local as ApiMethod
}

function transportMethod(spec: ChannelSpec, transport: ApiTransport): ApiMethod | undefined {
  const channel = spec.channel
  if (!channel) {
    throw new Error(`electronAPI builder: spec '${spec.path}' has no channel`)
  }
  const payload = (args: unknown[]) =>
    spec.toPayload ? spec.toPayload(...(args as never[])) : args[0]

  switch (spec.kind) {
    case 'invoke':
      return (...args: unknown[]) => transport.invoke(channel, payload(args))
    case 'send':
      return (...args: unknown[]) => transport.send(channel, payload(args))
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
