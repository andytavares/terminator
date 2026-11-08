import { describe, it, expect, vi } from 'vitest'
import { fakeWebContentsView } from '../../support/fake-web-contents'

type Handler = (event: unknown, payload?: unknown) => unknown
const handlers = vi.hoisted(() => new Map<string, Handler>())

vi.mock('electron', () => ({
  ipcMain: { handle: (channel: string, handler: Handler) => handlers.set(channel, handler) },
}))

import { registerFsHandlers } from '../../../src/main/ipc/fs.ipc'

registerFsHandlers()

describe('fs:watch-start', () => {
  it('rejects a payload without a root', async () => {
    const view = fakeWebContentsView()
    expect(await handlers.get('fs:watch-start')!({ sender: view.sender }, {})).toEqual({
      error: 'VALIDATION_ERROR',
    })
  })
})
