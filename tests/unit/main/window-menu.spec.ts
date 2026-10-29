import { describe, it, expect, vi } from 'vitest'
import { buildWindowMenu, laneAccelerator } from '../../../src/main/window-menu'

const BREAKOUT_SESSION = '3f2c1a9e-5b7d-4e8a-9c01-2d4f6a8b0c1e'

function items(focusedBreakoutSession: string | null = null) {
  const send = vi.fn()
  const menu = buildWindowMenu(send, focusedBreakoutSession)
  const submenu = menu.submenu as Electron.MenuItemConstructorOptions[]
  return { menu, submenu, send }
}

describe('buildWindowMenu', () => {
  it("is macOS's Window menu, so every open window (pop-outs included) is listed in it", () => {
    const { menu, submenu } = items()
    expect(menu.role).toBe('window')
    expect(submenu.map((i) => i.role).filter(Boolean)).toEqual(['minimize', 'zoom', 'front'])
  })

  it("leaves Cmd+` and Cmd+Shift+` to macOS's cycle-through-windows", () => {
    const accelerators = items().submenu.map((i) => i.accelerator)
    expect(accelerators).not.toContain('CmdOrCtrl+`')
    expect(accelerators).not.toContain('CmdOrCtrl+Shift+`')
  })

  it('opens Home on Cmd+Shift+H', () => {
    const { submenu, send } = items()
    const home = submenu.find((i) => i.label === 'Home')!
    expect(home.accelerator).toBe('CmdOrCtrl+Shift+H')
    ;(home.click as () => void)()
    expect(send).toHaveBeenCalledWith('menu:open-home')
  })

  it('closes the tab on Cmd+W', () => {
    const { submenu, send } = items()
    const close = submenu.find((i) => i.label === 'Close Tab')!
    expect(close.accelerator).toBe('CmdOrCtrl+W')
    ;(close.click as () => void)()
    expect(send).toHaveBeenCalledWith('menu:close-tab', { sessionId: null })
  })
})

describe('buildWindowMenu — Usage', () => {
  it('lists Usage right after Home, with no shortcut', () => {
    const { submenu, send } = items()
    const labels = submenu.map((i) => i.label)
    const usage = submenu[labels.indexOf('Home') + 1]
    expect(usage.label).toBe('Usage')
    expect(usage.accelerator).toBeUndefined()
    ;(usage.click as () => void)()
    expect(send).toHaveBeenCalledWith('menu:open-usage')
  })
})

describe('buildWindowMenu — lanes', () => {
  it('switches to lane 1–9 of the visible task on Ctrl+1–9', () => {
    const { submenu, send } = items()
    const lanes = submenu.find((i) => i.label === 'Switch Lane')!
    const entries = lanes.submenu as Electron.MenuItemConstructorOptions[]
    expect(entries.map((i) => i.accelerator)).toEqual(
      [0, 1, 2, 3, 4, 5, 6, 7, 8].map((lane) => laneAccelerator(lane, process.platform))
    )
    expect(entries[2].label).toBe('Lane 3')
    ;(entries[2].click as () => void)()
    expect(send).toHaveBeenCalledWith('menu:switch-lane', { lane: 2 })
  })
})

describe('laneAccelerator', () => {
  it('is Ctrl+n on a Mac, where Cmd+n switches workspaces', () => {
    expect(laneAccelerator(0, 'darwin')).toBe('Control+1')
    expect(laneAccelerator(8, 'darwin')).toBe('Control+9')
  })

  it('is Alt+n where Ctrl is the command key and Ctrl+n switches workspaces', () => {
    expect(laneAccelerator(1, 'linux')).toBe('Alt+2')
    expect(laneAccelerator(1, 'win32')).toBe('Alt+2')
  })
})

describe('buildWindowMenu in a breakout window', () => {
  it('closes the focused breakout terminal on Cmd+W, naming its session', () => {
    const { submenu, send } = items(BREAKOUT_SESSION)
    const close = submenu.find((i) => i.label === 'Close Terminal')!
    expect(submenu.find((i) => i.label === 'Close Tab')).toBeUndefined()
    ;(close.click as () => void)()
    expect(send).toHaveBeenCalledWith('menu:close-tab', { sessionId: BREAKOUT_SESSION })
  })

  it('moves the terminal to its own window on Cmd+Shift+O from the main window', () => {
    const { submenu, send } = items()
    const toggle = submenu.find((i) => i.label === 'Move Terminal to Its Own Window')!
    expect(toggle.accelerator).toBe('CmdOrCtrl+Shift+O')
    ;(toggle.click as () => void)()
    expect(send).toHaveBeenCalledWith('menu:toggle-breakout', { sessionId: null })
  })

  it('returns the focused breakout terminal to the main window', () => {
    const { submenu, send } = items(BREAKOUT_SESSION)
    const toggle = submenu.find((i) => i.label === 'Return Terminal to Main Window')!
    expect(toggle.accelerator).toBe('CmdOrCtrl+Shift+O')
    ;(toggle.click as () => void)()
    expect(send).toHaveBeenCalledWith('menu:toggle-breakout', { sessionId: BREAKOUT_SESSION })
  })
})

describe('buildWindowMenu — the task switcher', () => {
  it('opens the task switcher on Cmd+J', () => {
    const { submenu, send } = items()
    const switcher = submenu.find((i) => i.label === 'Switch Task…')!
    expect(switcher.accelerator).toBe('CmdOrCtrl+J')
    ;(switcher.click as () => void)()
    expect(send).toHaveBeenCalledWith('menu:open-task-switcher')
  })
})
