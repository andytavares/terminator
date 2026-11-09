import React from 'react'
import { describe, it, expect, beforeEach } from 'vitest'
import { render, screen, act } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useSidebarVisibility } from '../../../../src/shell/useSidebarVisibility'
import { useExtensionRegistry } from '../../../../src/extensions/registry'
import { useSettingsStore } from '../../../../src/stores/settings.store'
import { defaultGlobalSettings } from '../../../../../core-shared/src/settings-defaults'

// A stand-in for the shell: the sidebar element is in the DOM or it is not.
function Shell(): React.JSX.Element {
  const { sidebarVisible, toggleSidebar } = useSidebarVisibility()
  return (
    <div>
      {sidebarVisible && <nav aria-label="project tree" />}
      <button onClick={toggleSidebar}>toggle</button>
    </div>
  )
}

const hasTree = () => screen.queryByRole('navigation', { name: 'project tree' }) !== null
const showTab = (tabId: string | null) =>
  act(() => useExtensionRegistry.setState({ activeGlobalTabId: tabId }))
const setHideOnHome = (hideSidebarOnHome: boolean) =>
  act(() =>
    useSettingsStore.setState({
      globalSettings: {
        ...defaultGlobalSettings('/bin/zsh'),
        ui: {
          hasSeenWelcome: true,
          editor: '',
          hideSidebarOnHome,
          showUsageTab: true,
          homeLayout: 'tasks',
          sidebarMode: 'tree',
        },
      },
    })
  )

beforeEach(() => {
  useExtensionRegistry.setState({ activeGlobalTabId: null })
  useSettingsStore.setState({ globalSettings: defaultGlobalSettings('/bin/zsh') })
})

describe('useSidebarVisibility', () => {
  it('hides the project tree on Home', () => {
    showTab('core.home')
    render(<Shell />)
    expect(hasTree()).toBe(false)
  })

  it('shows it for this visit when toggled on Home, and hides it again after leaving and returning', async () => {
    const user = userEvent.setup()
    showTab('core.home')
    render(<Shell />)
    await user.click(screen.getByRole('button', { name: 'toggle' }))
    expect(hasTree()).toBe(true)
    showTab('core.overview')
    showTab('core.home')
    expect(hasTree()).toBe(false)
  })
})

describe('useSidebarVisibility — other tabs and the setting', () => {
  it('leaves other tabs on the user own toggle state', async () => {
    const user = userEvent.setup()
    showTab('core.overview')
    render(<Shell />)
    expect(hasTree()).toBe(true)
    await user.click(screen.getByRole('button', { name: 'toggle' }))
    expect(hasTree()).toBe(false)
    showTab('core.home')
    showTab('core.overview')
    expect(hasTree()).toBe(false)
  })

  it('does not let a toggle on Home change the user own state elsewhere', async () => {
    const user = userEvent.setup()
    showTab('core.home')
    render(<Shell />)
    await user.click(screen.getByRole('button', { name: 'toggle' }))
    showTab(null)
    expect(hasTree()).toBe(true)
  })

  it('keeps the project tree on Home when the setting is off', () => {
    setHideOnHome(false)
    showTab('core.home')
    render(<Shell />)
    expect(hasTree()).toBe(true)
  })
})
