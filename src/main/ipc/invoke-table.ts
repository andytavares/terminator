import { dispatchChannel, type ChannelSpec } from '@terminator/extension-sdk'
import { handleChannel } from './channel-registrar.js'

// Schema-driven registration for validated invoke channels. Each row declares
// the channel, its payload schema, the response for invalid payloads, and how
// to produce the success (and optionally failure) response. The
// parse → dispatch → error-envelope skeleton is the SDK's dispatchChannel,
// shared with extension channels.

export { noPayload } from '@terminator/extension-sdk'

export function registerInvokeTable(specs: ReadonlyArray<ChannelSpec>): void {
  for (const spec of specs) {
    handleChannel(spec.channel, (_event, payload) => dispatchChannel(spec, payload))
  }
}
