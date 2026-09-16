import { describe, it, expect, beforeEach, vi } from 'vitest'
import type { SessionRecordListing, SessionSnapshot } from '../../../../src/shared/types/index'

let changed:
  | ((payload: { sessionId: string; record: SessionRecordListing | null }) => void)
  | null = null

const api = {
  list: vi.fn(),
  forget: vi.fn(),
  setDescription: vi.fn(),
  setLink: vi.fn(),
  transfer: vi.fn(),
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

const record = (patch: Partial<SessionRecordListing> = {}): SessionRecordListing => ({
  ...SNAP,
  description: 'why',
  link: null,
  agent: null,
  resumable: false,
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

  it('moves a record onto the session that resumed it', async () => {
    useSessionRecordsStore.setState({ records: new Map([['s1', record()]]) })
    const resumed = { ...SNAP, sessionId: 's2' }
    api.transfer.mockResolvedValue({ data: record({ sessionId: 's2' }) })
    const ok = await useSessionRecordsStore.getState().transfer('s1', resumed)
    expect(api.transfer).toHaveBeenCalledWith({ fromSessionId: 's1', session: resumed })
    expect(ok).toBe(true)
    expect([...useSessionRecordsStore.getState().records.keys()]).toEqual(['s2'])
  })

  it('forgets the old record even when the new session keeps none', async () => {
    useSessionRecordsStore.setState({ records: new Map([['s1', record()]]) })
    api.transfer.mockResolvedValue({ data: null })
    await useSessionRecordsStore.getState().transfer('s1', { ...SNAP, sessionId: 's2' })
    expect(useSessionRecordsStore.getState().records.size).toBe(0)
  })

  it('changes nothing when the move is refused', async () => {
    useSessionRecordsStore.setState({ records: new Map([['s1', record()]]) })
    api.transfer.mockResolvedValue({ error: 'failed', message: 'nope' })
    expect(
      await useSessionRecordsStore.getState().transfer('s1', { ...SNAP, sessionId: 's2' })
    ).toBe(false)
    expect([...useSessionRecordsStore.getState().records.keys()]).toEqual(['s1'])
  })

  it('forgets a closed record and takes it out of the list', async () => {
    useSessionRecordsStore.setState({ records: new Map([['s1', record()]]) })
    api.forget.mockResolvedValue({ data: true })
    expect(await useSessionRecordsStore.getState().forget('s1')).toBe(true)
    expect(api.forget).toHaveBeenCalledWith({ sessionId: 's1' })
    expect(useSessionRecordsStore.getState().records.size).toBe(0)
  })

  it('keeps the record when the main process refused to forget it', async () => {
    useSessionRecordsStore.setState({ records: new Map([['s1', record()]]) })
    api.forget.mockResolvedValue({ data: false })
    expect(await useSessionRecordsStore.getState().forget('s1')).toBe(false)
    expect(useSessionRecordsStore.getState().records.size).toBe(1)
  })
})
