import type { IpcMainInvokeEvent, WebContents } from 'electron'
import type { z } from 'zod'
import { dispatchChannel, type ChannelSpec } from '@terminator/extension-sdk'
import { handleChannel } from './channel-registrar.js'

// Schema-driven registration for validated invoke channels. Each row declares
// the channel, its payload schema, the response for invalid payloads, and how
// to produce the success (and optionally failure) response. The
// parse → dispatch → error-envelope skeleton is the SDK's dispatchChannel,
// shared with extension channels.

export { noPayload } from '@terminator/extension-sdk'

/** A row whose answer depends on which view asked. The remote bridge has no view to name, so
 * such a channel must not be one the bridge can reach. */
export interface ViewChannelSpec extends Omit<ChannelSpec, 'run'> {
  fromView: true
  run: (args: never, sender: WebContents) => Promise<unknown> | unknown
}

/** Declares a row that is also given the view that asked (`event.sender`). */
export function defineViewChannel<S extends z.ZodType>(
  spec: Omit<ChannelSpec<S>, 'run'> & {
    run: (args: z.infer<S>, sender: WebContents) => Promise<unknown> | unknown
  }
): ViewChannelSpec {
  return { ...spec, fromView: true, run: (args, sender) => spec.run(args, sender) }
}

type InvokeRow = ChannelSpec | ViewChannelSpec

/** The row as the dispatcher runs it. The bridge's invoke has no event, and no view row. */
function asDispatched(spec: InvokeRow, event: IpcMainInvokeEvent): ChannelSpec {
  if (!('fromView' in spec)) return spec
  return { ...spec, run: (args) => spec.run(args as never, event.sender) }
}

export function registerInvokeTable(specs: ReadonlyArray<InvokeRow>): void {
  for (const spec of specs) {
    handleChannel(spec.channel, (event, payload) =>
      dispatchChannel(asDispatched(spec, event), payload)
    )
  }
}
