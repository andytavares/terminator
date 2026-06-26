import { describe, it, expect, beforeEach } from 'vitest'
import { useVaultNavStore } from '../../src/stores/vault-nav.store'

function resetStore() {
  useVaultNavStore.setState({
    activeView: 'daily',
    selectedAreaName: null,
    selectedProjectName: null,
    pendingTaskId: null,
    viewingDate: null,
    showCaptureModal: false,
    skipNextVisibilityReset: false,
  })
}

describe('useVaultNavStore', () => {
  beforeEach(resetStore)

  it('setView updates activeView', () => {
    useVaultNavStore.getState().setView('inbox')
    expect(useVaultNavStore.getState().activeView).toBe('inbox')
  })

  it('setShowCaptureModal toggles showCaptureModal', () => {
    useVaultNavStore.getState().setShowCaptureModal(true)
    expect(useVaultNavStore.getState().showCaptureModal).toBe(true)
    useVaultNavStore.getState().setShowCaptureModal(false)
    expect(useVaultNavStore.getState().showCaptureModal).toBe(false)
  })

  it('setViewingDate sets viewingDate', () => {
    useVaultNavStore.getState().setViewingDate('2026-06-01')
    expect(useVaultNavStore.getState().viewingDate).toBe('2026-06-01')
  })

  it('setViewingDate accepts null to clear viewingDate', () => {
    useVaultNavStore.setState({ viewingDate: '2026-06-01' })
    useVaultNavStore.getState().setViewingDate(null)
    expect(useVaultNavStore.getState().viewingDate).toBeNull()
  })

  it('navToArea sets view to areas and stores area name', () => {
    useVaultNavStore.getState().navToArea('work')
    const state = useVaultNavStore.getState()
    expect(state.activeView).toBe('areas')
    expect(state.selectedAreaName).toBe('work')
    expect(state.selectedProjectName).toBeNull()
  })

  it('navToProject sets view to projects and stores project name', () => {
    useVaultNavStore.getState().navToProject('my-project')
    const state = useVaultNavStore.getState()
    expect(state.activeView).toBe('projects')
    expect(state.selectedProjectName).toBe('my-project')
    expect(state.selectedAreaName).toBeNull()
  })

  it('navigateToTask sets view to daily, pendingTaskId, and viewingDate', () => {
    useVaultNavStore.getState().navigateToTask('task-123', '2026-06-01')
    const state = useVaultNavStore.getState()
    expect(state.activeView).toBe('daily')
    expect(state.pendingTaskId).toBe('task-123')
    expect(state.viewingDate).toBe('2026-06-01')
  })

  it('navigateToTask sets viewingDate to null when date is omitted', () => {
    useVaultNavStore.getState().navigateToTask('task-456')
    expect(useVaultNavStore.getState().viewingDate).toBeNull()
  })

  it('clearPendingTask nulls pendingTaskId', () => {
    useVaultNavStore.setState({ pendingTaskId: 'task-123' })
    useVaultNavStore.getState().clearPendingTask()
    expect(useVaultNavStore.getState().pendingTaskId).toBeNull()
  })

  it('skipNextVisibilityReset defaults to false', () => {
    expect(useVaultNavStore.getState().skipNextVisibilityReset).toBe(false)
  })

  it('setSkipNextVisibilityReset sets the flag to true', () => {
    useVaultNavStore.getState().setSkipNextVisibilityReset(true)
    expect(useVaultNavStore.getState().skipNextVisibilityReset).toBe(true)
  })

  it('setSkipNextVisibilityReset sets the flag back to false', () => {
    useVaultNavStore.setState({ skipNextVisibilityReset: true })
    useVaultNavStore.getState().setSkipNextVisibilityReset(false)
    expect(useVaultNavStore.getState().skipNextVisibilityReset).toBe(false)
  })
})
