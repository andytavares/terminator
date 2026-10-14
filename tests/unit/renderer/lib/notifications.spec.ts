import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { dispatchNotification } from '../../../../src/renderer/lib/notifications'
import type { ElectronAPI } from '../../../../src/shared/electron-api/api-type'
import { electronApiOf } from '../../../support/electron-api'

const mockCreate = vi.fn<ElectronAPI['notifications']['create']>()

beforeEach(() => {
  mockCreate.mockReset()
  vi.stubGlobal('window', { electronAPI: electronApiOf({ notifications: { create: mockCreate } }) })
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('dispatchNotification', () => {
  it('forwards the notification and key to window.electronAPI.notifications.create', () => {
    dispatchNotification({ type: 'info', title: 'Hello', message: 'World', key: 'helloKey' })
    expect(mockCreate).toHaveBeenCalledWith({
      type: 'info',
      title: 'Hello',
      message: 'World',
      key: 'helloKey',
    })
  })

  it('does not include a source or targets — those are resolved main-side', () => {
    dispatchNotification({ type: 'error', title: 'Oops', key: 'oopsKey' })
    expect(mockCreate).toHaveBeenCalledWith({ type: 'error', title: 'Oops', key: 'oopsKey' })
  })
})
