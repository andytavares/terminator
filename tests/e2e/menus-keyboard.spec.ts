import { test, expect } from '@playwright/test'
import { AppHandle, launchApp, closeApp } from './helpers'

// Every drop-down menu is the design system's Menu (spec 073, K1): it opens from its button with the
// keyboard, starts on its first item, moves with the arrow keys and closes with Escape, handing
// focus back to the button. Addressed by role, as a screen reader finds it.

let handle: AppHandle

test.beforeAll(async () => {
  handle = await launchApp()
})

test.afterAll(async () => {
  await closeApp(handle)
})

const MENUS = [
  { button: 'Display', menu: 'Display' },
  { button: 'Filter', menu: 'Filter' },
  { button: 'New terminal', menu: 'Start a terminal' },
]

for (const { button, menu } of MENUS) {
  test(`the ${button} menu is worked from the keyboard alone`, async () => {
    const { page } = handle
    const trigger = page.getByRole('button', { name: button, exact: true }).first()
    await expect(trigger).toHaveAttribute('aria-haspopup', 'menu')
    await trigger.focus()
    await page.keyboard.press('Enter')

    const opened = page.getByRole('menu', { name: menu })
    const items = opened.locator('[role^="menuitem"]:not(:disabled)')
    await expect(opened).toBeVisible()
    await expect(items.first()).toBeFocused()
    await page.keyboard.press('ArrowDown')
    await expect(items.nth(1)).toBeFocused()
    await page.keyboard.press('End')
    await expect(items.last()).toBeFocused()

    await page.keyboard.press('Escape')
    await expect(opened).toBeHidden()
    await expect(trigger).toBeFocused()
  })
}
