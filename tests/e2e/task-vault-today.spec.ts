import { test, expect, type Page } from '@playwright/test'
import { AppHandle, launchApp, closeApp } from './helpers'
import { invokeChannel } from './extension-page'
import { openVault, storedTask, todayTasks, type StoredTask, localDate } from './task-vault-harness'

// The daily log: everything a user does to a task on today's page, each read
// back from what the vault stored.

let handle: AppHandle
let vault: Page

test.beforeAll(async () => {
  handle = await launchApp()
  vault = await openVault(handle)
})

test.afterAll(async () => {
  await closeApp(handle)
})

function taskRow(text: string) {
  return vault
    .locator('.daily-log__task')
    .filter({ has: vault.getByText(text, { exact: true }) })
    .first()
}

async function addTask(text: string): Promise<void> {
  const addButton = vault.locator('.daily-log__add-btn')
  if (await addButton.isVisible()) await addButton.click()
  const input = vault.locator('.daily-log__add-row input')
  await input.fill(text)
  await input.press('Enter')
  await expect(taskRow(text)).toBeVisible()
  await expect(vault.locator('.daily-log__add-row')).toHaveCount(0)
}

async function rowAction(text: string, label: string): Promise<void> {
  await taskRow(text).hover()
  await taskRow(text).getByRole('button', { name: label, exact: true }).click()
}

async function stored(text: string): Promise<StoredTask> {
  const task = await storedTask(vault, text)
  if (!task) throw new Error(`the vault holds no task "${text}"`)
  return task
}

test('a task added from the empty day is logged for today', async () => {
  await vault.getByRole('button', { name: 'Add task', exact: true }).click()
  const input = vault.locator('.daily-log__add-row input')
  await input.fill('Write the release notes')
  await input.press('Enter')

  await expect(taskRow('Write the release notes')).toBeVisible()
  expect((await todayTasks(vault)).map((task) => task.text)).toEqual(['Write the release notes'])
})

test('double-clicking a task edits its text and tags', async () => {
  await taskRow('Write the release notes')
    .locator('.daily-log__task-text')
    .dblclick({ position: { x: 4, y: 4 } })
  const editor = vault.locator('.daily-log__task-edit input')
  await editor.fill('Write the 2.0 release notes due:2031-01-02')
  await vault.locator('.daily-log__task-edit').getByRole('button', { name: 'Save' }).click()

  await expect(taskRow('Write the 2.0 release notes')).toContainText('due:2031-01-02')
  expect(await stored('Write the 2.0 release notes')).toMatchObject({ dueDate: '2031-01-02' })
})

test('a subtask added to a task is listed under it', async () => {
  await rowAction('Write the 2.0 release notes', 'Add subtask')
  const input = vault.getByPlaceholder('Subtask…')
  await input.fill('Collect the changelog')
  await input.press('Enter')

  await expect(vault.locator('.daily-log__subtasks')).toContainText('Collect the changelog')
  const parent = (await todayTasks(vault)).find((task) => task.text.includes('2.0 release'))
  expect(parent?.subtasks?.map((task) => task.text)).toEqual(['Collect the changelog'])
})

test('completing a task strikes it through, and restoring reopens it', async () => {
  await addTask('Book the venue')
  await taskRow('Book the venue').getByRole('button', { name: 'Complete task' }).click()
  await expect(taskRow('Book the venue')).toHaveClass(/daily-log__task--done/)
  expect(await stored('Book the venue')).toMatchObject({ status: 'done' })

  await rowAction('Book the venue', 'Restore to open')
  await expect(taskRow('Book the venue')).not.toHaveClass(/daily-log__task--done/)
  expect(await stored('Book the venue')).toMatchObject({ status: 'open' })
})

test('blocking a task records why, and unblocking clears it', async () => {
  await rowAction('Book the venue', 'Mark as blocked')
  await vault
    .getByPlaceholder('Waiting on design review, blocked by dependency…')
    .fill('Waiting on the budget')
  await vault.getByRole('button', { name: '1 hr', exact: true }).click()
  await vault.getByRole('button', { name: 'Mark blocked' }).click()

  await expect(taskRow('Book the venue')).toContainText('Waiting on the budget')
  expect(await stored('Book the venue')).toMatchObject({
    status: 'blocked',
    blockedReason: 'Waiting on the budget',
  })

  await rowAction('Book the venue', 'Unblock')
  await expect(taskRow('Book the venue')).not.toContainText('Waiting on the budget')
  expect(await stored('Book the venue')).toMatchObject({ status: 'open' })
})

test('a recurrence can be set on a task and removed again', async () => {
  await rowAction('Book the venue', 'Set recurrence')
  await vault.getByRole('button', { name: 'Daily', exact: true }).click()
  await vault.getByRole('button', { name: 'Save', exact: true }).click()

  await expect(taskRow('Book the venue').locator('.daily-log__recurrence-badge')).toBeVisible()
  expect(await stored('Book the venue')).toMatchObject({ recurrenceRule: 'daily' })

  await rowAction('Book the venue', 'Recurrence: Daily')
  await vault.getByRole('button', { name: 'Remove', exact: true }).click()

  await expect(taskRow('Book the venue').locator('.daily-log__recurrence-badge')).toHaveCount(0)
  expect(await stored('Book the venue')).toHaveProperty('recurrenceRule', undefined)
})

test('migrating a task moves it to the day picked', async () => {
  await addTask('Call the printer')
  await rowAction('Call the printer', 'Migrate to another day')
  await taskRow('Call the printer').locator('.dtp__trigger').click()
  await vault.locator('.dtp__popover').getByRole('button', { name: 'Tomorrow' }).click()
  await taskRow('Call the printer').getByRole('button', { name: 'Move', exact: true }).click()

  await expect(
    taskRow('Call the printer').locator('.daily-log__task-text--strikethrough')
  ).toBeVisible()
  const tomorrow = await invokeChannel<{ tasks: StoredTask[] }>(
    vault,
    'task-vault:vault:get-daily',
    {
      date: localDate(1),
    }
  )
  expect(tomorrow.tasks.map((task) => [task.text, task.status])).toEqual([
    ['Call the printer', 'open'],
  ])
})

test('archiving a task cancels it, and removing it deletes it', async () => {
  await addTask('Order the banners')
  await rowAction('Order the banners', 'Archive task')
  await expect(taskRow('Order the banners')).toHaveClass(/daily-log__task--cancelled/)
  expect(await stored('Order the banners')).toMatchObject({ status: 'cancelled' })

  await rowAction('Order the banners', 'Remove')
  await expect(taskRow('Order the banners')).toHaveCount(0)
  expect(await storedTask(vault, 'Order the banners')).toBeUndefined()
})

test('dragging a task above another reorders the day', async () => {
  await addTask('Draft the agenda')
  await addTask('Send the invites')
  const order = async () =>
    (await todayTasks(vault))
      .map((task) => task.text)
      .filter((text) => ['Draft the agenda', 'Send the invites'].includes(text))
  expect(await order()).toEqual(['Draft the agenda', 'Send the invites'])

  await taskRow('Send the invites').dragTo(taskRow('Draft the agenda'))

  await expect.poll(order).toEqual(['Send the invites', 'Draft the agenda'])
  const shown = await vault.locator('.daily-log__task-text').allTextContents()
  expect(shown.indexOf('Send the invites')).toBeLessThan(shown.indexOf('Draft the agenda'))
})

test("a task's detail panel saves its description", async () => {
  await taskRow('Draft the agenda')
    .locator('.daily-log__task-text')
    .click({ position: { x: 4, y: 4 } })
  const panel = vault.locator('.tv-detail-panel')
  await expect(panel).toContainText('Draft the agenda')
  const description = panel.locator('.tv-detail__section').filter({ hasText: 'Description' })
  await description.getByRole('button', { name: 'Edit' }).click()
  await description.locator('textarea').fill('Three items, **one hour**.')
  await description.getByRole('button', { name: 'Save' }).click()

  await expect(description.locator('strong')).toHaveText('one hour')
  const id = (await stored('Draft the agenda')).id
  expect(
    await invokeChannel(vault, 'task-vault:vault:get-task-detail', { taskId: id })
  ).toMatchObject({ description: 'Three items, **one hour**.' })
  await panel.getByRole('button', { name: 'Close detail panel' }).click()
  await expect(panel).toHaveCount(0)
})

test('a backlog item is picked up for today, another is deleted', async () => {
  await rowAction('Send the invites', 'Send to backlog')
  await rowAction('Draft the agenda', 'Send to backlog')
  const backlogRow = (text: string) =>
    vault.locator('.daily-log__backlog-list > *').filter({ hasText: text })
  await expect(backlogRow('Send the invites')).toBeVisible()
  await expect(backlogRow('Draft the agenda')).toBeVisible()

  await backlogRow('Send the invites').hover()
  await backlogRow('Send the invites').getByRole('button', { name: 'Pick up today' }).click()
  await expect(taskRow('Send the invites')).toBeVisible()
  expect((await todayTasks(vault)).map((task) => task.text)).toContain('Send the invites')

  await backlogRow('Draft the agenda').hover()
  await backlogRow('Draft the agenda').getByRole('button', { name: 'Delete' }).click()
  await expect(backlogRow('Draft the agenda')).toHaveCount(0)
  expect(await storedTask(vault, 'Draft the agenda')).toBeUndefined()
})

test('a task rolled over from last week is marked stale until kept', async () => {
  for (let day = 0; day < 8; day++) {
    await vault.getByRole('button', { name: 'Previous day' }).click()
  }
  await expect(vault.locator('.daily-log__today-badge')).toHaveCount(0)
  await addTask('Renew the domain')
  await vault.getByTitle('Back to today').click()

  const row = taskRow('Renew the domain')
  await expect(row.locator('.daily-log__stale-badge')).toBeVisible()
  await row.getByRole('button', { name: 'keep' }).click()

  await expect(row.locator('.daily-log__stale-badge')).toHaveCount(0)
  const kept = (await todayTasks(vault)).find((task) => task.text === 'Renew the domain')
  expect(kept).toMatchObject({ todaySince: localDate() })
})
