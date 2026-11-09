// @vitest-environment jsdom
import React from 'react'
import { describe, it, expect, vi } from 'vitest'
import { act, render } from '@testing-library/react'

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
vi.mock('../../../../src/stores/workspace.store', () => ({
  useWorkspaceStore: stores.useStore,
}))
vi.mock('../../../../src/stores/settings.store', () => ({
  useSettingsStore: stores.useStore,
}))
vi.mock('../../../../src/stores/session.store', () => ({
  useSessionStore: stores.useStore,
}))
vi.mock('../../../../src/stores/session-records.store', () => ({
  useSessionRecordsStore: stores.useStore,
}))
vi.mock('../../../../src/stores/extension-commands.store', () => ({
  useExtensionCommandsStore: stores.useStore,
}))
vi.mock('../../../../src/stores/metrics.store', () => ({
  useMetricsStore: stores.useStore,
}))
vi.mock('../../../../src/quick-actions/use-active-scope', () => ({
  useActiveScope: noop,
}))
vi.mock('../../../../src/hooks/useBranchSync', () => ({ useBranchSync: noop }))
vi.mock('../../../../src/shell/agent-attention', () => ({ useAgentAttention: noop }))

import { useInitialLoad } from '../../../../src/shell/bootstrap'
import { useHomeFeedStore } from '../../../../src/stores/home-feed.store'
import { installElectronApi, pushedEvent } from '../../../../../test-support/src/electron-api'
import type { MergedHomeFeed } from '../../../../../core-shared/src/schemas/home-feed.schema'

function Shell(): null {
  useInitialLoad()
  return null
}

/** A feed holding one focus candidate, as main pushes it. */
function feedFocusing(title: string): MergedHomeFeed {
  const focus = { id: title, title, workKey: null, done: false, source: 'ext.focus' }
  return { asks: [], facets: [], measures: [], focus: [focus] }
}
const focusTitles = () => useHomeFeedStore.getState().focus.map((item) => item.title)

describe('useInitialLoad: the Home feed', () => {
  it('reads what extensions published and follows later changes until the window closes', async () => {
    const feedChanged = pushedEvent<[MergedHomeFeed]>()
    installElectronApi({
      schedules: { onRun: () => () => {} },
      terminal: { onProcessExit: () => () => {} },
      extension: { onCommandsChanged: () => () => {} },
      homeFeed: {
        get: async () => ({ data: feedFocusing('Ship login') }),
        onChanged: feedChanged.addListener,
      },
    })
    useHomeFeedStore.setState(useHomeFeedStore.getInitialState(), true)
    const { unmount } = render(<Shell />)
    await expect.poll(focusTitles).toEqual(['Ship login'])
    act(() => feedChanged.deliver(feedFocusing('Fix CI')))
    expect(focusTitles()).toEqual(['Fix CI'])
    unmount()
    feedChanged.deliver(feedFocusing('After close'))
    expect(focusTitles()).toEqual(['Fix CI'])
  })
})
