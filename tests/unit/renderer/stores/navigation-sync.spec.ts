import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { useNavigationStore } from '../../../../src/renderer/stores/navigation.store'
import { trackNavigation, goBack, goForward } from '../../../../src/renderer/stores/navigation-sync'
import { useExtensionRegistry } from '../../../../src/renderer/extensions/registry'
import { useWorkspaceStore } from '../../../../src/renderer/stores/workspace.store'
import { resetStore } from '../../../support/renderer-stores'

let stopTracking: () => void

beforeEach(() => {
  resetStore(useNavigationStore)
  resetStore(useExtensionRegistry)
  resetStore(useWorkspaceStore, { activeProjectId: 'p1' })
  stopTracking = trackNavigation()
})
afterEach(() => stopTracking())

describe('trackNavigation', () => {
  it('records a change of the shown tab, and restores it on back without recording', () => {
    useExtensionRegistry.getState().setActiveGlobalTab('core.home')
    useExtensionRegistry.getState().setActiveGlobalTab('core.overview')
    const recorded = useNavigationStore.getState().entries.length

    goBack()
    expect(useExtensionRegistry.getState().activeGlobalTabId).toBe('core.home')
    expect(useNavigationStore.getState().entries).toHaveLength(recorded)

    goForward()
    expect(useExtensionRegistry.getState().activeGlobalTabId).toBe('core.overview')
    expect(useNavigationStore.getState().entries).toHaveLength(recorded)
  })

  it('restores the active project', () => {
    useWorkspaceStore.getState().setActiveProject('p2')
    goBack()
    expect(useWorkspaceStore.getState().activeProjectId).toBe('p1')
  })
})
