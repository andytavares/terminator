import { describe, it, expect, beforeEach, vi } from 'vitest'

vi.mock('electron', () => ({
  app: { getPath: () => '/tmp', getVersion: () => '0.1.0' },
  globalShortcut: { register: vi.fn(), unregister: vi.fn(), isRegistered: vi.fn(() => false) },
  ipcMain: { handle: vi.fn(), removeHandler: vi.fn() },
}))
vi.mock('../../../src/main/logger', () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
  makeLogger: () => ({ debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }),
}))

import { createExtensionAPI, getApiDisposables } from '../../../src/main/extensions/api'
import { fullFeed } from '../home/home-feed.fixtures'
import { getMergedFeed, runAction } from '../../../src/main/home/home-feed'

const feed = fullFeed()

function unloadedApi() {
  const api = createExtensionAPI('test.home', {} as never)
  api.home.publish(feed)
  for (const disposable of getApiDisposables(api)) disposable.dispose()
  return api
}

beforeEach(() => {
  for (const disposable of getApiDisposables(createExtensionAPI('test.home', {} as never)))
    disposable.dispose()
})

describe('api.home after the extension unloads', () => {
  it('clears the feed it published', () => {
    const api = createExtensionAPI('test.home', {} as never)
    api.home.publish(feed)
    expect(getMergedFeed().asks).not.toEqual([])
    for (const disposable of getApiDisposables(api)) disposable.dispose()
    expect(getMergedFeed().asks).toEqual([])
  })

  it('drops a later publish', () => {
    const api = unloadedApi()
    api.home.publish(feed)
    expect(getMergedFeed().asks).toEqual([])
  })

  it('registers no action handler once unloaded', async () => {
    const api = unloadedApi()
    const handler = vi.fn()
    api.home.onAction(handler)
    await expect(runAction('test.home', 'ask-1', 'open')).rejects.toThrow(/handles no Home actions/)
    expect(handler).not.toHaveBeenCalled()
  })
})
