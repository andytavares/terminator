import { test, expect, type Page } from '@playwright/test'
import { AppHandle, launchApp, closeApp, createWorkspace } from './helpers'
import { extensionFrame } from './extension-page'
import { expectCentredInWindow } from './modal-centre'

// ADR 114's whole point: an extension's view is a frame in the window, so a
// modal draws over it instead of the view being hidden. A WebContentsView could
// never do this — the panel went away while Quick Actions was open.

let handle: AppHandle

test.beforeAll(async () => {
  handle = await launchApp()
  await createWorkspace(handle.page, 'layering', process.cwd())
})

test.afterAll(async () => {
  await closeApp(handle)
})

const PANEL = '[data-extension-panel="terminator.task-vault"]'

async function openTaskVault(): Promise<void> {
  await handle.page.locator('button[aria-label="Task Vault"]').click()
  await expect(handle.page.locator(PANEL)).toHaveCount(1, { timeout: 20000 })
  await expect
    .poll(async () => {
      const frame = extensionFrame(handle, 'task-vault')
      if (!frame) return false
      return frame.evaluate(() => document.readyState === 'complete').catch(() => false)
    })
    .toBe(true)
}

async function openQuickActions(page: Page): Promise<void> {
  await page.keyboard.press('ControlOrMeta+p')
  await expect(page.getByRole('dialog', { name: 'Quick actions' })).toBeVisible({
    timeout: 10000,
  })
}

test('Quick Actions draws over the extension frame, which stays up', async () => {
  await openTaskVault()

  const frameBox = await handle.page.locator(`${PANEL} iframe`).boundingBox()
  expect(frameBox, 'the Task Vault iframe has no box').not.toBeNull()

  await openQuickActions(handle.page)
  const dialog = handle.page.getByRole('dialog', { name: 'Quick actions' })
  await expectCentredInWindow(dialog, 'Quick actions over Task Vault')

  // The frame is still there and still the same size — not hidden for the modal.
  const duringBox = await handle.page.locator(`${PANEL} iframe`).boundingBox()
  expect(duringBox).toEqual(frameBox)

  // The dialog's centre hits the dialog, not the frame: it really is on top.
  const hitTest = await handle.page.evaluate((selector) => {
    const el = document.querySelector(selector)
    if (!el) return 'no dialog'
    const r = el.getBoundingClientRect()
    const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2)
    return hit && el.contains(hit) ? 'inside' : 'not inside'
  }, 'dialog[open]')
  expect(hitTest, 'something else paints over Quick Actions').toBe('inside')

  await handle.page.keyboard.press('Escape')
  await expect(dialog).toBeHidden()

  // And the frame is still up afterwards.
  await expect(handle.page.locator(`${PANEL} iframe`)).toBeVisible()
})
