import type { ExtensionAPI, Disposable, ChannelSpec } from '@terminator/extension-sdk'

import { REMOTE_READ_CHANNELS } from '../remote-access.js'

export const disposables: Disposable[] = []

export function reg(api: ExtensionAPI, ...specs: ChannelSpec[]): void {
  for (const spec of specs) {
    const remoteAccessible = REMOTE_READ_CHANNELS.has(spec.channel)
    disposables.push(api.ipc.registerHandler(spec, { remoteAccessible }))
  }
}

/** What every registration needs: the host, and where the records live now. */
export interface ActivationContext {
  readonly api: ExtensionAPI
  readonly dataRoot: () => string
}
