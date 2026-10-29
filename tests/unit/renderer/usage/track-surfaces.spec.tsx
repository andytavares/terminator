import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// This spec checks the IPC payload, so it runs the real recorder (tests/setup.ts mocks it).
vi.unmock('../../../../src/renderer/usage/record')
import { renderHook, act } from '@testing-library/react'
import { useExtensionRegistry } from '../../../../src/renderer/extensions/registry'
import { useTrackSurfaces } from '../../../../src/renderer/usage/track-surfaces'
import { IDLE_LIMIT_MS } from '../../../../src/renderer/usage/active-time'
import type { ElectronAPI } from '../../../../src/shared/electron-api/api-type'
import { resetStore } from '../../../support/renderer-stores'
import { installElectronApi } from '../../../support/electron-api'

const recordUse = vi.fn<ElectronAPI['usage']['recordUse']>(async () => ({ data: true as const }))
const declare = vi.fn<ElectronAPI['usage']['declare']>(async () => ({ data: true as const }))
const Nothing = (): null => null

/** The clock the hook reads: only `Date` is faked, so React and the DOM run as usual. */
function clockAt(ms: number): void {
  vi.setSystemTime(ms)
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  clockAt(0)
  vi.clearAllMocks()
  installElectronApi({ usage: { recordUse, declare } })
  resetStore(useExtensionRegistry)
  vi.spyOn(document, 'hasFocus').mockReturnValue(true)
})

afterEach(() => vi.useRealTimers())

const registry = () => useExtensionRegistry.getState()
const recorded = () => recordUse.mock.calls.map(([record]) => record)
const press = (): void => void window.dispatchEvent(new KeyboardEvent('keydown'))

function registerExtensionTab(): void {
  registry().registerGlobalTab({ id: 'git', label: 'Git', component: Nothing })
}

describe('useTrackSurfaces', () => {
  it('declares each registered surface with the id of its slot', () => {
    registerExtensionTab()
    registry().registerGlobalTab({ id: 'core.home', label: 'Home', component: Nothing })
    registry().registerSidebarPanel({ id: 'notes', label: 'Notes', component: Nothing })
    renderHook(() => useTrackSurfaces())
    const features = declare.mock.calls.flatMap(([input]) => input.features)
    expect(features).toEqual(
      expect.arrayContaining([
        { id: 'git.global-tab', label: 'Git', kind: 'surface', source: 'git' },
        { id: 'core.home', label: 'Home', kind: 'surface', source: 'core' },
        { id: 'notes.sidebar-panel', label: 'Notes', kind: 'surface', source: 'notes' },
        { id: 'core.open-home', label: 'Home', kind: 'action', source: 'core' },
      ])
    )
  })

  it('declares a surface registered after mount', () => {
    renderHook(() => useTrackSurfaces())
    act(() => registerExtensionTab())
    const features = declare.mock.calls.flatMap(([input]) => input.features)
    expect(features.map((f) => f.id)).toContain('git.global-tab')
  })
})

describe('useTrackSurfaces — uses and time', () => {
  it('counts one use when a tab becomes active and flushes its time when it stops', () => {
    registerExtensionTab()
    renderHook(() => useTrackSurfaces())
    press()
    act(() => registry().setActiveGlobalTab('git'))
    expect(recorded()).toContainEqual({ feature: 'git.global-tab', via: 'shown' })
    clockAt(40_000)
    act(() => registry().setActiveGlobalTab(null))
    expect(recorded()).toContainEqual({
      feature: 'git.global-tab',
      via: 'shown',
      activeMs: 40_000,
    })
  })

  it('does not count a use again while the tab stays active', () => {
    registerExtensionTab()
    renderHook(() => useTrackSurfaces())
    act(() => registry().setActiveGlobalTab('git'))
    act(() => registry().setActiveProjectTab('x'))
    const uses = recorded().filter((r) => r.feature === 'git.global-tab' && !r.activeMs)
    expect(uses).toHaveLength(1)
  })

  it('counts a panel when it opens', () => {
    renderHook(() => useTrackSurfaces())
    act(() => registry().togglePanel('notes'))
    expect(recorded()).toContainEqual({ feature: 'notes.sidebar-panel', via: 'shown' })
  })
})

describe('useTrackSurfaces — focus and idle', () => {
  it('flushes the time on window blur and counts nothing while blurred', () => {
    registerExtensionTab()
    renderHook(() => useTrackSurfaces())
    press()
    act(() => registry().setActiveGlobalTab('git'))
    clockAt(15_000)
    act(() => void window.dispatchEvent(new Event('blur')))
    expect(recorded()).toContainEqual({ feature: 'git.global-tab', via: 'shown', activeMs: 15_000 })
    clockAt(90_000)
    act(() => registry().setActiveGlobalTab(null))
    expect(recorded().filter((r) => r.feature === 'git.global-tab' && r.activeMs)).toHaveLength(1)
  })
})

describe('useTrackSurfaces — idle and unload', () => {
  it('stops counting five minutes after the last input', () => {
    registerExtensionTab()
    renderHook(() => useTrackSurfaces())
    press()
    act(() => registry().setActiveGlobalTab('git'))
    clockAt(IDLE_LIMIT_MS + 20 * 60_000)
    act(() => registry().setActiveGlobalTab(null))
    expect(recorded()).toContainEqual({
      feature: 'git.global-tab',
      via: 'shown',
      activeMs: IDLE_LIMIT_MS,
    })
  })

  it('flushes the application time on beforeunload', () => {
    renderHook(() => useTrackSurfaces())
    press()
    clockAt(25_000)
    act(() => void window.dispatchEvent(new Event('beforeunload')))
    expect(recorded()).toContainEqual({
      feature: 'core.app.active',
      via: 'shown',
      activeMs: 25_000,
    })
  })
})
