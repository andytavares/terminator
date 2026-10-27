import { test, expect } from '@playwright/test'
import { AppHandle, launchApp, closeApp } from './helpers'
import { invokeChannel, type ExtensionView } from './extension-page'
import { openVault, localDate } from './task-vault-harness'

// The calendar beside the log: jumping from a day in the calendar to a task.

let handle: AppHandle
let vault: ExtensionView

/** A day in this month's calendar grid other than today. */
const OTHER_DAY =
  localDate(1).slice(0, 7) === localDate(0).slice(0, 7) ? localDate(1) : localDate(-1)

function calendarDay(date: string) {
  return vault.locator('.cal-drawer__cell').filter({
    has: vault.locator('.cal-drawer__day-num').getByText(String(Number(date.slice(8))), {
      exact: true,
    }),
  })
}

test.beforeAll(async () => {
  handle = await launchApp()
  vault = await openVault(handle)
  await invokeChannel(vault, 'task-vault:vault:add-task', {
    filePath: `daily/${OTHER_DAY}.md`,
    text: 'Present the moodboard',
  })
})

test.afterAll(async () => {
  await closeApp(handle)
})

test('a task picked in the calendar opens on its day, selected', async () => {
  await calendarDay(OTHER_DAY).click()
  await vault.locator('.cal-drawer__day-task', { hasText: 'Present the moodboard' }).click()

  await expect(vault.locator('.tv-detail-panel')).toContainText('Present the moodboard')
  await expect(
    vault.locator('.daily-log__task-text', { hasText: 'Present the moodboard' })
  ).toBeVisible()
  await expect(vault.locator('.daily-log__today-badge')).toHaveCount(0)
})
