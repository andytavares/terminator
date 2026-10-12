import { dispatchChannel, type ChannelSpec } from '@terminator/extension-sdk'
import { handleChannel } from './channel-registrar.js'

// Schema-driven registration for validated invoke channels. Each row declares
// the channel, its payload schema, the response for invalid payloads, and how
// to produce the success (and optionally failure) response. The
// parse → dispatch → error-envelope skeleton is the SDK's dispatchChannel,
// shared with extension channels.

export { noPayload } from '@terminator/extension-sdk'

const registeredSpecs = new Map<string, ChannelSpec>()

/** The table row a channel was registered from; undefined for a channel not registered here. */
export function registeredInvokeSpec(channel: string): ChannelSpec | undefined {
  return registeredSpecs.get(channel)
}

export function registerInvokeTable(specs: ReadonlyArray<ChannelSpec>): void {
  for (const spec of specs) {
    registeredSpecs.set(spec.channel, spec)
    handleChannel(spec.channel, (_event, payload) => dispatchChannel(spec, payload))
  }
}
