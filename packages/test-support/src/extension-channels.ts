import type { ChannelSpec, ExtensionAPI, ExtensionDB } from '@terminator/extension-sdk'
import { partialFake } from './fakes'

type Registrar = (api: ExtensionAPI, db: ExtensionDB) => unknown

/** Runs an extension's IPC registrars and answers, per channel, whether it was declared
 *  remote-accessible. */
export function remoteAccessByChannel(registrars: Registrar[]): Map<string, boolean> {
  const remoteByChannel = new Map<string, boolean>()
  const api = partialFake<ExtensionAPI>({
    ipc: partialFake<ExtensionAPI['ipc']>({
      registerHandler: (spec: ChannelSpec, opts?: { remoteAccessible?: boolean }) => {
        remoteByChannel.set(spec.channel, opts?.remoteAccessible === true)
        return { dispose: () => {} }
      },
    }),
  })
  const db = partialFake<ExtensionDB>({})
  for (const register of registrars) register(api, db)
  return remoteByChannel
}
