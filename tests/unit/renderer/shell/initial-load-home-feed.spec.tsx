// @vitest-environment jsdom
import React from 'react'
import { describe, it, expect, vi } from 'vitest'
import { render } from '@testing-library/react'

const noop = vi.hoisted(() => vi.fn())
const stores = vi.hoisted(() => {
  const state = {
    loadWorkspaces: () => {},
    loadSettings: () => {},
    load: () => Promise.resolve(),
    subscribe: () => () => {},
    refresh: () => Promise.resolve(),
    handleProcessExit: () => {},
  }
  return { useStore: Object.assign(() => state, { getState: () => state }) }
})
vi.mock('../../../../src/renderer/stores/workspace.store', () => ({
  useWorkspaceStore: stores.useStore,
}))
vi.mock('../../../../src/renderer/stores/settings.store', () => ({
  useSettingsStore: stores.useStore,
}))
vi.mock('../../../../src/renderer/stores/session.store', () => ({
  useSessionStore: stores.useStore,
}))
vi.mock('../../../../src/renderer/stores/session-records.store', () => ({
  useSessionRecordsStore: stores.useStore,
}))
vi.mock('../../../../src/renderer/stores/extension-commands.store', () => ({
  useExtensionCommandsStore: stores.useStore,
}))
vi.mock('../../../../src/renderer/stores/metrics.store', () => ({
  useMetricsStore: stores.useStore,
}))
vi.mock('../../../../src/renderer/quick-actions/use-active-scope', () => ({
  useActiveScope: noop,
}))
vi.mock('../../../../src/renderer/hooks/useBranchSync', () => ({ useBranchSync: noop }))
vi.mock('../../../../src/renderer/shell/agent-attention', () => ({ useAgentAttention: noop }))

import { useInitialLoad } from '../../../../src/renderer/shell/bootstrap'
import { useHomeFeedStore } from '../../../../src/renderer/stores/home-feed.store'
import { installElectronApi } from '../../../support/electron-api'

function Shell(): null {
  useInitialLoad()
  return null
}

describe('useInitialLoad: the Home feed', () => {
  it('reads what extensions published and follows later changes until the window closes', () => {
    const unsubscribe = vi.fn()
    const load = vi.fn().mockResolvedValue(undefined)
    const subscribe = vi.fn(() => unsubscribe)
    installElectronApi({
      terminal: { onProcessExit: () => () => {} },
      extension: { onCommandsChanged: () => () => {} },
    })
    useHomeFeedStore.setState({ load, subscribe })
    const { unmount } = render(<Shell />)
    expect(load).toHaveBeenCalledOnce()
    expect(subscribe).toHaveBeenCalledOnce()
    unmount()
    expect(unsubscribe).toHaveBeenCalledOnce()
  })
})
