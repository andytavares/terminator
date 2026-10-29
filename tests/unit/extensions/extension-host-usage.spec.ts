import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mkdirSync, writeFileSync, rmSync } from 'fs'
import { join } from 'path'
import os from 'os'
import { newExtensionHost } from './fake-backend-host'

vi.mock('electron', () => ({ app: { getPath: () => '/tmp', getVersion: () => '0.1.0' } }))

const storeData: Record<string, unknown> = { extensions: [] }
vi.mock('electron-store', () => ({
  default: class MockStore {
    onDidAnyChange() {
      return () => {}
    }
    get(key: string) {
      return storeData[key]
    }
    set(key: string, value: unknown) {
      storeData[key] = value
    }
  },
}))
vi.mock('../../../src/main/storage/extension-settings-store', () => ({
  getExtensionSetting: () => undefined,
  setExtensionSetting: vi.fn(),
  getAllExtensionSettings: () => ({}),
}))
vi.mock('../../../src/main/logger', () => {
  const log = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }
  return { makeLogger: () => log, logger: log }
})
const usageStore = vi.hoisted(() => ({
  declare: vi.fn(() => Promise.resolve()),
  recordUse: vi.fn(() => Promise.resolve()),
}))
vi.mock('../../../src/main/usage/usage-store', () => ({ getUsageStore: () => usageStore }))

let bundle: string

beforeEach(() => {
  vi.resetModules()
  storeData.extensions = []
  usageStore.declare.mockClear()
  bundle = join(os.tmpdir(), `ext-usage-${Date.now()}-${Math.random()}`)
})

afterEach(() => rmSync(bundle, { recursive: true, force: true }))

function writeExtension(id: string, contributes: unknown): string {
  const directory = join(bundle, id)
  mkdirSync(directory, { recursive: true })
  writeFileSync(
    join(directory, 'manifest.json'),
    JSON.stringify({
      id,
      name: id,
      version: '1.0.0',
      description: 'Test',
      main: 'main.js',
      minAppVersion: '0.0.1',
      contributes,
    })
  )
  return bundle
}

describe('ExtensionHost declares the usage a manifest contributes', () => {
  it('declares usage items, manifest commands, window views and the insights section', async () => {
    const { host } = await newExtensionHost({ 'com.demo': () => {} })
    await host.startAll({
      bundledDirectory: writeExtension('com.demo', {
        usage: [{ id: 'go-to-run', label: 'Go to run' }],
        commands: [{ id: 'open', label: 'Open it' }],
        windowViews: [{ id: 'board', view: 'board' }],
        insightsSection: { label: 'Demo insights' },
      }),
      beforeActivation: Promise.resolve(),
    })

    expect(usageStore.declare).toHaveBeenCalledWith(
      expect.arrayContaining([
        { id: 'com.demo.go-to-run', label: 'Go to run', kind: 'control', source: 'com.demo' },
        { id: 'com.demo.command.open', label: 'Open it', kind: 'command', source: 'com.demo' },
        { id: 'com.demo.board', label: 'board', kind: 'surface', source: 'com.demo' },
        {
          id: 'com.demo.insights-section',
          label: 'Demo insights',
          kind: 'surface',
          source: 'com.demo',
        },
      ])
    )
  })
})
