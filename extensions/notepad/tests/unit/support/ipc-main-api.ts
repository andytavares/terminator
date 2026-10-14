import { vi } from 'vitest'
import { ipcMain } from 'electron'
import { dispatchChannel, type ChannelSpec, type ExtensionAPI } from '@terminator/extension-sdk'
import { partialFake } from '../../../../../tests/support/fakes'

/** An API whose registerHandler forwards to the spec's mocked `ipcMain`, so the spec captures and
 *  asserts on `ipcMain.handle` and `removeHandler` calls. The spec must vi.mock('electron'). */
export function apiOverIpcMain(): ExtensionAPI {
  return partialFake<ExtensionAPI>({
    ipc: partialFake<ExtensionAPI['ipc']>({
      registerHandler: (spec: ChannelSpec) => {
        vi.mocked(ipcMain.handle)(spec.channel, (_e, payload: unknown) =>
          dispatchChannel(spec, payload)
        )
        return { dispose: () => vi.mocked(ipcMain.removeHandler)(spec.channel) }
      },
    }),
  })
}
