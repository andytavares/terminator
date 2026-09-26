import { describe, expect, it } from 'vitest'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'

import { createSignalStore } from '../../src/sensors/store'
import type { Signal } from '../../src/sensors/types'

function tempRoot(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'foundry-signal-store-'))
}

function signal(overrides: Partial<Signal> = {}): Signal {
  return {
    id: 'sig-1',
    sensorId: 'sensor-a',
    key: 'ci-flake',
    title: 'CI is flaky',
    evidence: [
      {
        kind: 'ci-run',
        title: 'run 1',
        url: 'https://example.com/1',
        at: '2026-01-01T00:00:00.000Z',
      },
    ],
    occurrences: 1,
    severity: 'low',
    firstSeen: '2026-01-01T00:00:00.000Z',
    lastSeen: '2026-01-01T00:00:00.000Z',
    status: 'open',
    dismissedAt: null,
    orderId: null,
    ...overrides,
  }
}

describe('createSignalStore', () => {
  it('saves then lists signals', async () => {
    const root = tempRoot()
    const store = createSignalStore(root)
    await store.save([signal()])
    const listed = await store.list()
    expect(listed).toEqual([signal()])
  })

  it('appends a new line on status change and list returns the latest', async () => {
    const root = tempRoot()
    const store = createSignalStore(root)
    await store.save([signal({ status: 'open' })])
    await store.save([signal({ status: 'promoted', orderId: 'order-1' })])

    const jsonlPath = path.join(root, 'signals', 'signals.jsonl')
    const lines = fs.readFileSync(jsonlPath, 'utf-8').trim().split('\n')
    expect(lines).toHaveLength(2)

    const listed = await store.list()
    expect(listed).toHaveLength(1)
    expect(listed[0].status).toBe('promoted')
    expect(listed[0].orderId).toBe('order-1')
  })

  it('skips an identical save, appending nothing', async () => {
    const root = tempRoot()
    const store = createSignalStore(root)
    await store.save([signal()])
    await store.save([signal()])

    const jsonlPath = path.join(root, 'signals', 'signals.jsonl')
    const lines = fs.readFileSync(jsonlPath, 'utf-8').trim().split('\n')
    expect(lines).toHaveLength(1)
  })

  it('skips a truncated last line rather than throwing', async () => {
    const root = tempRoot()
    const store = createSignalStore(root)
    await store.save([signal()])

    const dir = path.join(root, 'signals')
    const jsonlPath = path.join(dir, 'signals.jsonl')
    fs.appendFileSync(jsonlPath, '{"id":"sig-2","sensorId":"sensor-a"' /* torn, no newline */)

    const listed = await store.list()
    expect(listed).toEqual([signal()])
  })

  it('gets a signal by id, or null when absent', async () => {
    const root = tempRoot()
    const store = createSignalStore(root)
    await store.save([signal()])
    expect(await store.get('sig-1')).toEqual(signal())
    expect(await store.get('missing')).toBeNull()
  })

  it('reads empty sensor state when nothing was stored', async () => {
    const root = tempRoot()
    const store = createSignalStore(root)
    expect(await store.sensorState()).toEqual({})
  })

  it('merges and persists sensor state across a new store instance', async () => {
    const root = tempRoot()
    const store = createSignalStore(root)
    await store.setSensorState('sensor-a', { enabled: true, lastRunAt: '2026-01-01T00:00:00.000Z' })
    const merged = await store.setSensorState('sensor-a', { lastProblem: 'timed out' })

    expect(merged['sensor-a']).toEqual({
      enabled: true,
      lastRunAt: '2026-01-01T00:00:00.000Z',
      lastProblem: 'timed out',
    })

    const other = createSignalStore(root)
    expect(await other.sensorState()).toEqual({
      'sensor-a': {
        enabled: true,
        lastRunAt: '2026-01-01T00:00:00.000Z',
        lastProblem: 'timed out',
      },
    })
  })

  it('merges which repository a sensor watches', async () => {
    const root = tempRoot()
    const store = createSignalStore(root)
    await store.setSensorState('sensor-a', { enabled: true, repoPath: '/repo' })
    const merged = await store.setSensorState('sensor-a', { repoPath: null })

    expect(merged['sensor-a'].repoPath).toBeNull()
  })

  it('writes nothing outside <dataRoot>/signals', async () => {
    const root = tempRoot()
    const store = createSignalStore(root)
    await store.save([signal()])
    await store.setSensorState('sensor-a', { enabled: true })

    const rootEntries = fs.readdirSync(root)
    expect(rootEntries).toEqual(['signals'])

    const signalsEntries = fs.readdirSync(path.join(root, 'signals')).sort()
    expect(signalsEntries).toEqual(['signals.jsonl', 'state.json'])
  })
})
