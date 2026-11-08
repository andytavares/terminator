import { test, expect } from '@playwright/test'
import { AppHandle, launchApp, closeApp } from './helpers'
import { invokeChannel, type ExtensionView } from './extension-page'
import { dailyLogTaskRow, localDate, openVault } from './task-vault-harness'

// What only the running app shows: the vault's stylesheet revealing a row's actions, its
// tooltips in its own view, and a notice that goes to main and comes back as one toast. The
// daily log's other behaviours are renderer and IPC tests under extensions/task-vault/tests.

let handle: AppHandle
let vault: ExtensionView

test.beforeAll(async () => {
  handle = await launchApp()
  vault = await openVault(handle)
})

test.afterAll(async () => {
  await closeApp(handle)
})

test('a task is sent to the backlog from the keyboard, and the vault says so once', async () => {
  await invokeChannel(vault, 'task-vault:vault:add-task', {
    filePath: `daily/${localDate()}.md`,
    text: 'Order the badges',
  })
  const row = dailyLogTaskRow(vault, 'Order the badges')
  const sendToBacklog = row.getByRole('button', { name: 'Send to backlog', exact: true })

  await sendToBacklog.focus()
  await expect(sendToBacklog).toBeFocused()
  const actions = row.locator('.daily-log__task-actions')
  await expect(actions).toHaveCSS('opacity', '1')
  await expect(actions).toHaveCSS('pointer-events', 'auto')
  await expect(vault.locator('.tmui-tooltip')).toHaveText('Send to backlog')
  await expect(vault.locator('.tmui-tooltip')).toBeVisible()

  await sendToBacklog.press('Enter')
  const backlogRow = vault
    .locator('.daily-log__backlog-list > *')
    .filter({ hasText: 'Order the badges' })
  await expect(backlogRow).toBeVisible()
  const toast = vault
    .locator('.tmui-toast')
    .filter({ hasText: 'Moved to backlog: Order the badges' })
  await expect(toast, 'one move, one toast').toHaveCount(1)
  // The vault's view covers the core's toast region, so the core leaves the toast to it.
  await expect(
    handle.page.locator('.tmui-toast').filter({ hasText: 'Moved to backlog' })
  ).toHaveCount(0)
})
