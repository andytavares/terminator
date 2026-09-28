import { describe, it, expect, vi } from 'vitest'
import { buildWindowMenu } from '../../../src/main/window-menu'

function items() {
  const send = vi.fn()
  const menu = buildWindowMenu(send)
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
    expect(send).toHaveBeenCalledWith('menu:close-tab')
  })
})
