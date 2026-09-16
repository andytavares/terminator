import { describe, it, expect, beforeEach, vi } from 'vitest'
import type { SessionRecord, SessionSnapshot } from '../../../../src/shared/types/index'

let changed: ((payload: { sessionId: string; record: SessionRecord | null }) => void) | null = null

const api = {
  list: vi.fn(),
  setDescription: vi.fn(),
  setLink: vi.fn(),
  onChanged: vi.fn((handler: typeof changed) => {
    changed = handler
    return () => {
      changed = null
    }
  }),
}

Object.defineProperty(globalThis, 'window', {
  value: { electronAPI: { sessionRecords: api } },
  writable: true,
})

import { useSessionRecordsStore } from '../../../../src/renderer/stores/session-records.store'

const SNAP: SessionSnapshot = {
  sessionId: 's1',
  projectId: 'p1',
  workspaceName: 'Northwind',
  projectName: 'northwind-api',
  branch: 'main',
  tabTitle: 'zsh',
  shell: '/bin/zsh',
  startedAt: '2026-09-15T10:00:00.000Z',
}

const record = (patch: Partial<SessionRecord> = {}): SessionRecord => ({
  ...SNAP,
  description: 'why',
  link: null,
  updatedAt: SNAP.startedAt,
  ...patch,
})

beforeEach(() => {
  vi.clearAllMocks()
  useSessionRecordsStore.setState({ records: new Map() })
})

describe('session records store', () => {
  it('loads every record the main process holds', async () => {
    api.list.mockResolvedValue({ data: [record(), record({ sessionId: 's2' })] })
    await useSessionRecordsStore.getState().load()
    expect([...useSessionRecordsStore.getState().records.keys()]).toEqual(['s1', 's2'])
  })

  it('keeps what it had when the list call fails', async () => {
    useSessionRecordsStore.setState({ records: new Map([['s1', record()]]) })
    api.list.mockRejectedValue(new Error('gone'))
    await useSessionRecordsStore.getState().load()
    expect(useSessionRecordsStore.getState().records.size).toBe(1)
  })

  it('applies a pushed change and a pushed delete', () => {
    const off = useSessionRecordsStore.getState().subscribe()
    changed?.({ sessionId: 's1', record: record({ description: 'pushed' }) })
    expect(useSessionRecordsStore.getState().records.get('s1')?.description).toBe('pushed')
    changed?.({ sessionId: 's1', record: null })
    expect(useSessionRecordsStore.getState().records.has('s1')).toBe(false)
    off()
    expect(changed).toBeNull()
  })

  it('writes a description with the snapshot and applies the result', async () => {
    api.setDescription.mockResolvedValue({ data: record({ description: 'new' }) })
    const ok = await useSessionRecordsStore.getState().setDescription(SNAP, 'new')
    expect(api.setDescription).toHaveBeenCalledWith({ session: SNAP, description: 'new' })
    expect(ok).toBe(true)
    expect(useSessionRecordsStore.getState().records.get('s1')?.description).toBe('new')
  })

  it('drops the record when a write removed it', async () => {
    useSessionRecordsStore.setState({ records: new Map([['s1', record()]]) })
    api.setDescription.mockResolvedValue({ data: null })
    await useSessionRecordsStore.getState().setDescription(SNAP, null)
    expect(useSessionRecordsStore.getState().records.has('s1')).toBe(false)
  })

  it('reports a refused write and changes nothing', async () => {
    useSessionRecordsStore.setState({ records: new Map([['s1', record()]]) })
    api.setDescription.mockResolvedValue({ error: 'RECORD_CLOSED', message: 'closed' })
    const ok = await useSessionRecordsStore.getState().setDescription(SNAP, 'late')
    expect(ok).toBe(false)
    expect(useSessionRecordsStore.getState().records.get('s1')?.description).toBe('why')
  })

  it('writes a session link', async () => {
    const link = { tracker: 'linear' as const, key: 'NW-88' }
    api.setLink.mockResolvedValue({ data: record({ link }) })
    await useSessionRecordsStore.getState().setLink(SNAP, link)
    expect(api.setLink).toHaveBeenCalledWith({ session: SNAP, link })
    expect(useSessionRecordsStore.getState().records.get('s1')?.link).toEqual(link)
  })
})
