import { test, expect } from '@playwright/test'
import { AppHandle, launchApp, closeApp, closeSettingsPanel } from './helpers'
import { invokeChannel, type ExtensionView } from './extension-page'
import { openExtensionSettings, settingRow } from './extension-settings-page'
import {
  dailyLogTaskRow,
  goToSection,
  openVault,
  storedTask,
  todayTasks,
  type StoredTask,
  localDate,
  pressRowAction,
} from './task-vault-harness'
import { expectCentredInWindow } from './modal-centre'

// A day is planned and worked on the daily log: every step is something a user
// does to a task on today's page, read back from what the vault stored. The
// steps run in order and build on each other's tasks.

let handle: AppHandle
let vault: ExtensionView

test.beforeAll(async () => {
  handle = await launchApp()
  vault = await openVault(handle)
})

test.afterAll(async () => {
  await closeApp(handle)
})

async function addTaskToToday(text: string): Promise<void> {
  const addButton = vault.locator('.daily-log__add-btn')
  if (await addButton.isVisible()) await addButton.click()
  const input = vault.locator('.daily-log__add-row input')
  await input.fill(text)
  await input.press('Enter')
  await expect(dailyLogTaskRow(vault, text)).toBeVisible()
  await expect(vault.locator('.daily-log__add-row')).toHaveCount(0)
}

async function rowAction(text: string, label: string): Promise<void> {
  await pressRowAction(
    dailyLogTaskRow(vault, text).getByRole('button', { name: label, exact: true })
  )
}

async function storedTaskNamed(text: string): Promise<StoredTask> {
  const task = await storedTask(vault, text)
  if (!task) throw new Error(`the vault holds no task "${text}"`)
  return task
}

/** A task added from the empty day is logged for today. */
async function addFromEmptyDay(): Promise<void> {
  await vault.getByRole('button', { name: 'Add task', exact: true }).click()
  const input = vault.locator('.daily-log__add-row input')
  await input.fill('Write the release notes')
  await input.press('Enter')

  await expect(dailyLogTaskRow(vault, 'Write the release notes')).toBeVisible()
  expect((await todayTasks(vault)).map((task) => task.text)).toEqual(['Write the release notes'])
}

/** Double-clicking a task edits its text and tags. */
async function editTextAndTags(): Promise<void> {
  await dailyLogTaskRow(vault, 'Write the release notes')
    .locator('.daily-log__task-text')
    .dblclick({ position: { x: 4, y: 4 } })
  const editor = vault.locator('.daily-log__task-edit input')
  await editor.fill('Write the 2.0 release notes due:2031-01-02')
  await vault.locator('.daily-log__task-edit').getByRole('button', { name: 'Save' }).click()

  await expect(dailyLogTaskRow(vault, 'Write the 2.0 release notes')).toContainText(
    'due:2031-01-02'
  )
  await expect
    .poll(() => storedTaskNamed('Write the 2.0 release notes'))
    .toMatchObject({
      dueDate: '2031-01-02',
    })
}

/** A subtask added to a task is listed under it. */
async function addSubtask(): Promise<void> {
  await rowAction('Write the 2.0 release notes', 'Add subtask')
  const input = vault.getByPlaceholder('Subtask…')
  await input.fill('Collect the changelog')
  await input.press('Enter')

  await expect(vault.locator('.daily-log__subtasks')).toContainText('Collect the changelog')
  const parent = (await todayTasks(vault)).find((task) => task.text.includes('2.0 release'))
  expect(parent?.subtasks?.map((task) => task.text)).toEqual(['Collect the changelog'])
}

/** Completing a task strikes it through, and restoring reopens it. */
async function completeAndRestore(): Promise<void> {
  await addTaskToToday('Book the venue')
  await dailyLogTaskRow(vault, 'Book the venue')
    .getByRole('button', { name: 'Complete task' })
    .click()
  await expect(dailyLogTaskRow(vault, 'Book the venue')).toHaveClass(/daily-log__task--done/)
  await expect.poll(() => storedTaskNamed('Book the venue')).toMatchObject({ status: 'done' })

  await rowAction('Book the venue', 'Restore to open')
  await expect(dailyLogTaskRow(vault, 'Book the venue')).not.toHaveClass(/daily-log__task--done/)
  await expect.poll(() => storedTaskNamed('Book the venue')).toMatchObject({ status: 'open' })
}

/** Blocking a task records why, and unblocking clears it. */
async function blockAndUnblock(): Promise<void> {
  await rowAction('Book the venue', 'Mark as blocked')
  await expectCentredInWindow(vault.getByRole('dialog'), 'Task Vault: Mark as blocked')
  await vault
    .getByPlaceholder('Waiting on design review, blocked by dependency…')
    .fill('Waiting on the budget')
  await vault.getByRole('button', { name: '1 hr', exact: true }).click()
  await vault.getByRole('button', { name: 'Mark blocked' }).click()

  await expect(dailyLogTaskRow(vault, 'Book the venue')).toContainText('Waiting on the budget')
  await expect
    .poll(() => storedTaskNamed('Book the venue'))
    .toMatchObject({
      status: 'blocked',
      blockedReason: 'Waiting on the budget',
    })

  await rowAction('Book the venue', 'Unblock')
  await expect(dailyLogTaskRow(vault, 'Book the venue')).not.toContainText('Waiting on the budget')
  await expect.poll(() => storedTaskNamed('Book the venue')).toMatchObject({ status: 'open' })
}

/** A recurrence can be set on a task and removed again. */
async function setAndRemoveRecurrence(): Promise<void> {
  await rowAction('Book the venue', 'Set recurrence')
  await expectCentredInWindow(vault.getByRole('dialog'), 'Task Vault: Set recurrence')
  await vault.getByRole('button', { name: 'Daily', exact: true }).click()
  await vault.getByRole('button', { name: 'Save', exact: true }).click()

  await expect(
    dailyLogTaskRow(vault, 'Book the venue').locator('.daily-log__recurrence-badge')
  ).toBeVisible()
  await expect
    .poll(() => storedTaskNamed('Book the venue'))
    .toMatchObject({ recurrenceRule: 'daily' })

  await rowAction('Book the venue', 'Recurrence: Daily')
  await vault.getByRole('button', { name: 'Remove', exact: true }).click()

  await expect(
    dailyLogTaskRow(vault, 'Book the venue').locator('.daily-log__recurrence-badge')
  ).toHaveCount(0)
  await expect
    .poll(() => storedTaskNamed('Book the venue'))
    .toHaveProperty('recurrenceRule', undefined)
}

/** Migrating a task moves it to the day picked. */
async function migrateToTomorrow(): Promise<void> {
  await addTaskToToday('Call the printer')
  await rowAction('Call the printer', 'Migrate to another day')
  await dailyLogTaskRow(vault, 'Call the printer').locator('.dtp__trigger').click()
  await vault.locator('.dtp__popover').getByRole('button', { name: 'Tomorrow' }).click()
  await dailyLogTaskRow(vault, 'Call the printer')
    .getByRole('button', { name: 'Move', exact: true })
    .click()

  await expect(
    dailyLogTaskRow(vault, 'Call the printer').locator('.daily-log__task-text--strikethrough')
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
}

/** Archiving a task cancels it, and removing it deletes it. */
async function archiveAndRemove(): Promise<void> {
  await addTaskToToday('Order the banners')
  await rowAction('Order the banners', 'Archive task')
  await expect(dailyLogTaskRow(vault, 'Order the banners')).toHaveClass(
    /daily-log__task--cancelled/
  )
  await expect
    .poll(() => storedTaskNamed('Order the banners'))
    .toMatchObject({ status: 'cancelled' })

  await rowAction('Order the banners', 'Remove')
  await expect(dailyLogTaskRow(vault, 'Order the banners')).toHaveCount(0)
  await expect.poll(() => storedTask(vault, 'Order the banners')).toBeUndefined()
}

/** Dragging a task above another reorders the day. */
async function dragToReorder(): Promise<void> {
  await addTaskToToday('Draft the agenda')
  await addTaskToToday('Send the invites')
  const taskOrder = async () =>
    (await todayTasks(vault))
      .map((task) => task.text)
      .filter((text) => ['Draft the agenda', 'Send the invites'].includes(text))
  await expect.poll(() => taskOrder()).toEqual(['Draft the agenda', 'Send the invites'])

  await dailyLogTaskRow(vault, 'Send the invites').dragTo(
    dailyLogTaskRow(vault, 'Draft the agenda')
  )

  await expect.poll(taskOrder).toEqual(['Send the invites', 'Draft the agenda'])
  const shown = await vault.locator('.daily-log__task-text').allTextContents()
  expect(shown.indexOf('Send the invites')).toBeLessThan(shown.indexOf('Draft the agenda'))
}

/** A task's detail panel saves its description. */
async function saveDetailDescription(): Promise<void> {
  await dailyLogTaskRow(vault, 'Draft the agenda')
    .locator('.daily-log__task-text')
    .click({ position: { x: 4, y: 4 } })
  const panel = vault.locator('.tv-detail-panel')
  await expect(panel).toContainText('Draft the agenda')
  const description = panel.locator('.tv-detail__section').filter({ hasText: 'Description' })
  await description.getByRole('button', { name: 'Edit' }).click()
  await description.locator('textarea').fill('Three items, **one hour**.')
  await description.getByRole('button', { name: 'Save' }).click()

  await expect(description.locator('strong')).toHaveText('one hour')
  const id = (await storedTaskNamed('Draft the agenda')).id
  expect(
    await invokeChannel(vault, 'task-vault:vault:get-task-detail', { taskId: id })
  ).toMatchObject({ description: 'Three items, **one hour**.' })
  await panel.getByRole('button', { name: 'Close detail panel' }).click()
  await expect(panel).toHaveCount(0)
}

/** A backlog item is picked up for today, another is deleted. */
async function pickUpAndDeleteBacklog(): Promise<void> {
  await rowAction('Send the invites', 'Send to backlog')
  const backlogRow = (text: string) =>
    vault.locator('.daily-log__backlog-list > *').filter({ hasText: text })
  // The row appears after the refresh, which follows the dispatcher's answer and so its push.
  await expect(backlogRow('Send the invites')).toBeVisible()
  const toast = vault
    .locator('.tmui-toast')
    .filter({ hasText: 'Moved to backlog: Send the invites' })
  await expect(toast, 'one move, one toast').toHaveCount(1)
  // The core leaves it to the vault, whose view covers the core's toast region.
  const coreCopy = handle.page.locator('.tmui-toast').filter({ hasText: 'Moved to backlog' })
  await expect(coreCopy).toHaveCount(0)
  await rowAction('Draft the agenda', 'Send to backlog')
  await expect(backlogRow('Draft the agenda')).toBeVisible()

  await pressRowAction(
    backlogRow('Send the invites').getByRole('button', { name: 'Pick up today' })
  )
  await expect(dailyLogTaskRow(vault, 'Send the invites')).toBeVisible()
  expect((await todayTasks(vault)).map((task) => task.text)).toContain('Send the invites')

  await pressRowAction(backlogRow('Draft the agenda').getByRole('button', { name: 'Delete' }))
  await expect(backlogRow('Draft the agenda')).toHaveCount(0)
  await expect.poll(() => storedTask(vault, 'Draft the agenda')).toBeUndefined()
}

/** A task rolled over from last week is marked stale until kept. */
async function keepStaleRollover(): Promise<void> {
  await addTaskDaysAgo('Renew the domain', 8)

  const row = dailyLogTaskRow(vault, 'Renew the domain')
  await expect(row.locator('.daily-log__stale-badge')).toBeVisible()
  await row.getByRole('button', { name: 'keep' }).click()

  await expect(row.locator('.daily-log__stale-badge')).toHaveCount(0)
  const kept = (await todayTasks(vault)).find((task) => task.text === 'Renew the domain')
  expect(kept).toMatchObject({ todaySince: localDate() })
}

/** Keyboard focus on a row's icon names it, inside the vault's own view. */
async function focusNamesIcon(): Promise<void> {
  await addTaskToToday('Book the room')
  // Focus, not hover: see pressRowAction. The pointer path is covered by icon-tooltips.spec.tsx.
  await dailyLogTaskRow(vault, 'Book the room')
    .getByRole('button', { name: 'Mark as blocked', exact: true })
    .focus()
  await expect(vault.locator('.tmui-tooltip')).toHaveText('Mark as blocked')
  await expect(vault.locator('.tmui-tooltip')).toBeVisible()
}

/** A row's actions show for keyboard focus, not only for the pointer. */
async function focusShowsRowActions(): Promise<void> {
  await addTaskToToday('Order the badges')
  const archive = dailyLogTaskRow(vault, 'Order the badges').getByRole('button', {
    name: 'Archive task',
    exact: true,
  })
  await archive.focus()
  // The actions fade in; the assertion waits for where the fade ends.
  const actions = dailyLogTaskRow(vault, 'Order the badges').locator('.daily-log__task-actions')
  await expect(actions).toHaveCSS('opacity', '1')
  await expect(actions).toHaveCSS('pointer-events', 'auto')
}

/** Adds a task on the day `daysAgo` before today, then returns to today, where it rolls over. */
async function addTaskDaysAgo(text: string, daysAgo: number): Promise<void> {
  for (let day = 0; day < daysAgo; day++) {
    await vault.getByRole('button', { name: 'Previous day' }).click()
  }
  await expect(vault.locator('.daily-log__today-badge')).toHaveCount(0)
  await addTaskToToday(text)
  await vault.getByTitle('Back to today').click()
}

/** "Stale Task Threshold", set on the settings page, decides when a rolled-over task is stale. */
async function staleThresholdSetting(): Promise<void> {
  await addTaskDaysAgo('Book the dentist', 5)
  const row = dailyLogTaskRow(vault, 'Book the dentist')
  // Five days is within the default seven.
  await expect(row).toBeVisible()
  await expect(row.locator('.daily-log__stale-badge')).toHaveCount(0)

  const settings = await openExtensionSettings(handle.page, 'Task Vault')
  await settingRow(settings, 'Stale Task Threshold (days)').locator('input').fill('3')
  await closeSettingsPanel(handle.page)

  await vault.reload()
  await goToSection(vault, 'Today')
  await expect(row.locator('.daily-log__stale-badge')).toBeVisible()
}

const A_DAY_OF_WORK: [string, () => Promise<void>][] = [
  ['a task added from the empty day is logged for today', addFromEmptyDay],
  ['double-clicking a task edits its text and tags', editTextAndTags],
  ['a subtask added to a task is listed under it', addSubtask],
  ['completing a task strikes it through, and restoring reopens it', completeAndRestore],
  ['blocking a task records why, and unblocking clears it', blockAndUnblock],
  ['a recurrence can be set on a task and removed again', setAndRemoveRecurrence],
  ['migrating a task moves it to the day picked', migrateToTomorrow],
  ['archiving a task cancels it, and removing it deletes it', archiveAndRemove],
  ['dragging a task above another reorders the day', dragToReorder],
  ["a task's detail panel saves its description", saveDetailDescription],
  ['a backlog item is picked up for today, another is deleted', pickUpAndDeleteBacklog],
  ['a task rolled over from last week is marked stale until kept', keepStaleRollover],
  [
    '"Stale Task Threshold" in Settings decides when a rolled-over task is stale',
    staleThresholdSetting,
  ],
  ["keyboard focus on a row's icon names it, inside the vault's own view", focusNamesIcon],
  ["a row's actions show for keyboard focus, not only for the pointer", focusShowsRowActions],
]

test('a day is planned and worked, task by task, on the daily log', async () => {
  for (const [title, step] of A_DAY_OF_WORK) await test.step(title, step)
})
