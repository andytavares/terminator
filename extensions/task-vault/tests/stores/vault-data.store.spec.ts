import { describe, it, expect, beforeEach, vi } from 'vitest'

// Mock electronAPI before importing stores
const mockInvoke = vi.fn()

import { useVaultDataStore } from '../../src/stores/vault-data.store'
import { useVaultNavStore } from '../../src/stores/vault-nav.store'

function resetStores() {
  vi.stubGlobal('window', {
    electronAPI: {
      extensionBridge: { invoke: mockInvoke },
    },
  })
  useVaultDataStore.setState({
    todayLog: null,
    inboxCount: 0,
    somedayTasks: [],
    calendarRefreshKey: 0,
    isLoading: false,
    error: null,
    lastRolledOver: 0,
    rolledOverTaskIds: [],
  })
  useVaultNavStore.setState({
    activeView: 'daily',
    selectedAreaName: null,
    selectedProjectName: null,
    pendingTaskId: null,
    viewingDate: null,
    showCaptureModal: false,
  })
  mockInvoke.mockReset()
}

describe('useVaultDataStore', useVaultDataStoreTests)

function useVaultDataStoreTests() {
  beforeEach(resetStores)

  useVaultDataStoreTickCalendarTests()
}

function useVaultDataStoreTickCalendarTests() {
  describe('tickCalendar', tickCalendarTests)
  describe('loadToday', loadTodayTests)
  describe('loadDate', loadDateTests)
  describe('refreshInboxCount', refreshInboxCountTests)
  describe('loadSomeday', loadSomedayTests)
  describe('loads that answer out of order', outOfOrderLoadTests)
}

function tickCalendarTests() {
  it('increments calendarRefreshKey', () => {
    const before = useVaultDataStore.getState().calendarRefreshKey
    useVaultDataStore.getState().tickCalendar()
    expect(useVaultDataStore.getState().calendarRefreshKey).toBe(before + 1)
  })
}

function loadTodayTests() {
  it('sets todayLog and updates viewingDate to today on success', async () => {
    const fakeLog = { date: '2026-06-09', tasks: [] }
    mockInvoke.mockResolvedValueOnce(fakeLog)
    await useVaultDataStore.getState().loadToday()
    expect(useVaultDataStore.getState().todayLog).toEqual(fakeLog)
    expect(useVaultDataStore.getState().isLoading).toBe(false)
    const d = new Date()
    const today = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
    expect(useVaultNavStore.getState().viewingDate).toBe(today)
  })

  it('sets error when API returns error object', async () => {
    mockInvoke.mockResolvedValueOnce({ error: 'NOT_CONFIGURED' })
    await useVaultDataStore.getState().loadToday()
    expect(useVaultDataStore.getState().error).toBe('NOT_CONFIGURED')
    expect(useVaultDataStore.getState().isLoading).toBe(false)
  })

  it('sets error when API throws', async () => {
    mockInvoke.mockRejectedValueOnce(new Error('network error'))
    await useVaultDataStore.getState().loadToday()
    expect(useVaultDataStore.getState().error).toContain('network error')
  })
}

function loadDateTests() {
  it('sets todayLog and updates viewingDate to the requested date on success', async () => {
    const fakeLog = { date: '2026-06-01', tasks: [] }
    mockInvoke.mockResolvedValueOnce(fakeLog)
    await useVaultDataStore.getState().loadDate('2026-06-01')
    expect(useVaultDataStore.getState().todayLog).toEqual(fakeLog)
    expect(useVaultNavStore.getState().viewingDate).toBe('2026-06-01')
  })

  it('sets error when API returns error object', async () => {
    mockInvoke.mockResolvedValueOnce({ error: 'NOT_CONFIGURED' })
    await useVaultDataStore.getState().loadDate('2026-06-01')
    expect(useVaultDataStore.getState().error).toBe('NOT_CONFIGURED')
  })

  it('sets error when API throws', async () => {
    mockInvoke.mockRejectedValueOnce(new Error('fail'))
    await useVaultDataStore.getState().loadDate('2026-06-01')
    expect(useVaultDataStore.getState().error).toContain('fail')
  })
}

function refreshInboxCountTests() {
  it('updates inboxCount from API result', async () => {
    mockInvoke.mockResolvedValueOnce({ tasks: [{}, {}, {}] })
    await useVaultDataStore.getState().refreshInboxCount()
    expect(useVaultDataStore.getState().inboxCount).toBe(3)
  })

  it('does not throw when API fails', async () => {
    mockInvoke.mockRejectedValueOnce(new Error('vault not configured'))
    await expect(useVaultDataStore.getState().refreshInboxCount()).resolves.toBeUndefined()
  })
}

function loadSomedayTests() {
  it('updates somedayTasks from API result', async () => {
    const tasks = [{ id: 'task-1', text: 'some day task' }]
    mockInvoke.mockResolvedValueOnce({ tasks })
    await useVaultDataStore.getState().loadSomeday()
    expect(useVaultDataStore.getState().somedayTasks).toEqual(tasks)
  })

  it('does not throw when API fails', async () => {
    mockInvoke.mockRejectedValueOnce(new Error('vault not configured'))
    await expect(useVaultDataStore.getState().loadSomeday()).resolves.toBeUndefined()
  })
}

/** A vault answer the test gives later, in whatever order it chooses. */
function answerLater() {
  let answer = (_value: unknown): void => {}
  mockInvoke.mockImplementationOnce(() => new Promise((resolve) => (answer = resolve)))
  return (value: unknown) => answer(value)
}

function outOfOrderLoadTests() {
  it('keeps the latest load when an earlier one answers after it', async () => {
    const answerEarlier = answerLater()
    const earlier = useVaultDataStore.getState().loadToday()
    const answerLatest = answerLater()
    const latest = useVaultDataStore.getState().loadToday()
    answerLatest({ date: '2026-06-09', tasks: [{ id: 't1', todaySince: '2026-06-09' }] })
    await latest
    answerEarlier({ date: '2026-06-09', tasks: [{ id: 't1', todaySince: '2026-06-01' }] })
    await earlier
    expect(useVaultDataStore.getState().todayLog?.tasks).toEqual([
      { id: 't1', todaySince: '2026-06-09' },
    ])
    expect(useVaultDataStore.getState().isLoading).toBe(false)
  })

  it('keeps today when a day asked for before it answers after it', async () => {
    const answerDay = answerLater()
    const day = useVaultDataStore.getState().loadDate('2026-06-01')
    const answerToday = answerLater()
    const today = useVaultDataStore.getState().loadToday()
    answerToday({ date: '2026-06-09', tasks: [] })
    await today
    answerDay({ date: '2026-06-01', tasks: [] })
    await day
    expect(useVaultDataStore.getState().todayLog?.date).toBe('2026-06-09')
    expect(useVaultNavStore.getState().viewingDate).not.toBe('2026-06-01')
  })
}
