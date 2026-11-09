import { describe, it, expect, vi } from 'vitest'
import { buildHelpMenu, buildViewMenu, tickPanelItem } from '../../../src/app-menu'

const VAULT_CALENDAR: Electron.MenuItemConstructorOptions = {
  id: 'task-vault.toggle-calendar',
  label: 'Toggle Vault Calendar',
  type: 'checkbox',
}

function viewMenu(extensionItems: Electron.MenuItemConstructorOptions[] = []) {
  const actions = { send: vi.fn(), pressKey: vi.fn(), openDevTools: vi.fn(), extensionItems }
  const submenu = buildViewMenu(actions).submenu as Electron.MenuItemConstructorOptions[]
  const click = (label: string): void => {
    const item = submenu.find((candidate) => candidate.label === label)!
    ;(item.click as () => void)()
  }
  return { submenu, click, ...actions }
}

describe('View menu', () => {
  it('asks the window to toggle the sidebar on Cmd+B', () => {
    const { submenu, click, send } = viewMenu()
    expect(submenu.find((item) => item.label === 'Toggle Sidebar')?.accelerator).toBe('CmdOrCtrl+B')
    click('Toggle Sidebar')
    expect(send).toHaveBeenCalledWith('menu:toggle-sidebar')
  })

  it('asks the window to open Settings on Cmd+,', () => {
    const { submenu, click, send } = viewMenu()
    expect(submenu.find((item) => item.label === 'Open Settings')?.accelerator).toBe('CmdOrCtrl+,')
    click('Open Settings')
    expect(send).toHaveBeenCalledWith('menu:open-settings')
  })

  it("lists an extension's items between their own separators, and none when there are none", () => {
    const labels = (items: Electron.MenuItemConstructorOptions[]) =>
      items.map((item) => item.label ?? item.type)
    expect(labels(viewMenu([VAULT_CALENDAR]).submenu).slice(5, 8)).toEqual([
      'separator',
      'Toggle Vault Calendar',
      'separator',
    ])
    expect(labels(viewMenu().submenu).slice(5, 7)).toEqual(['separator', 'Open Settings'])
  })
})

describe('Help menu', () => {
  it('opens About, named after the app', () => {
    const openAbout = vi.fn()
    const submenu = buildHelpMenu('Terminator', openAbout, vi.fn())
      .submenu as Electron.MenuItemConstructorOptions[]
    const about = submenu.find((item) => item.label === 'About Terminator')!
    ;(about.click as () => void)()
    expect(openAbout).toHaveBeenCalledTimes(1)
  })

  it('hands the repository URL to the browser from View on GitHub', () => {
    const openExternal = vi.fn()
    const submenu = buildHelpMenu('Terminator', vi.fn(), openExternal)
      .submenu as Electron.MenuItemConstructorOptions[]
    ;(submenu.find((item) => item.label === 'View on GitHub')!.click as () => void)()
    expect(openExternal).toHaveBeenCalledWith('https://github.com/anthropics/terminator')
  })
})

describe('tickPanelItem', () => {
  it("ticks and unticks the panel's item as the window reports it open and closed", () => {
    const item = { checked: false }
    const menu = { getMenuItemById: (id: string) => (id === VAULT_CALENDAR.id ? item : null) }
    tickPanelItem(menu, VAULT_CALENDAR.id, true)
    expect(item.checked).toBe(true)
    tickPanelItem(menu, VAULT_CALENDAR.id, false)
    expect(item.checked).toBe(false)
  })

  it('changes nothing for a panel with no menu item', () => {
    const item = { checked: false }
    tickPanelItem({ getMenuItemById: () => item }, undefined, true)
    expect(item.checked).toBe(false)
  })
})
