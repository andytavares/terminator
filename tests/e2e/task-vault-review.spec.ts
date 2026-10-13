import { test, expect, type Page } from '@playwright/test'
import { existsSync, mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { AppHandle, launchApp, closeApp } from './helpers'
import { answerNextSaveDialog, invokeChannel } from './extension-page'
import { goTo, openVault, storedTask, localDate } from './task-vault-harness'

// The six-step weekly review, walked end to end: every decision a step offers
// is made once, then the review is read back from History and exported.

let handle: AppHandle
let vault: Page

async function projectStatus(name: string): Promise<string | undefined> {
  const result = await invokeChannel<{ projects: { name: string; status: string }[] }>(
    vault,
    'task-vault:projects:list',
    { status: ['active', 'someday', 'archived'] }
  )
  return result.projects.find((project) => project.name === name)?.status
}

/** What the review finds waiting: projects in each state, a stale task and a backlog item. */
async function seedTheWeek(): Promise<void> {
  const call = (channel: string, payload: unknown) =>
    invokeChannel(vault, `task-vault:${channel}`, payload)
  await call('projects:create', { name: 'Garden Shed' })
  await call('projects:create', { name: 'Kitchen Remodel' })
  await call('vault:add-task', {
    filePath: 'projects/Kitchen Remodel.md',
    text: 'Pick the tiles @Kitchen-Remodel',
  })
  await call('projects:create', { name: 'Learn Piano' })
  await call('vault:update-project-status', { projectFilePath: 'Learn Piano', status: 'someday' })
  for (const [text, daysAgo] of [
    ['Sort the receipts', 10],
    ['Fix the bike', 10],
    ['Call the bank', 10],
  ] as const) {
    await call('vault:add-task', { filePath: `daily/${localDate(-daysAgo)}.md`, text })
  }
  for (const text of ['Read the backlog novel', 'Retire the old laptop']) {
    const { taskId } = (await call('vault:capture', { text })) as { taskId: string }
    await call('vault:process-inbox-item', { taskId, action: 'someday' })
  }
}

test.beforeAll(async () => {
  handle = await launchApp()
  vault = await openVault(handle)
  await seedTheWeek()
  // Opening today rolls last week's open tasks over, which is what makes them stale.
  await invokeChannel(vault, 'task-vault:vault:get-today')
  await goTo(vault, 'Weekly review')
  await expect(vault.locator('.weekly-review__steps')).toBeVisible()
})

test.afterAll(async () => {
  await closeApp(handle)
})

test('step 1 captures loose items into the inbox', async () => {
  await vault.getByPlaceholder('Add to inbox…').fill('Pay the parking fine')
  await vault.getByPlaceholder('Add to inbox…').press('Enter')
  await expect(vault.locator('.wr-step__captured-item')).toHaveText(['Pay the parking fine'])
  await vault.getByRole('button', { name: 'Next: inbox' }).click()
})

test('step 2 clarifies what was captured', async () => {
  await expect(vault.locator('.inbox-processor__text')).toHaveText('Pay the parking fine')
  await vault.getByRole('button', { name: 'Yes' }).click()
  await vault.getByRole('button', { name: 'Do now — Today' }).click()
  await expect(vault.getByText('Inbox cleared!')).toBeVisible()
  expect(await storedTask(vault, 'Pay the parking fine')).toMatchObject({ status: 'in-progress' })
  await vault.getByRole('button', { name: 'Next: projects' }).click()
})

test('step 3 keeps a live project and shelves a stale one', async () => {
  const item = (name: string) => vault.locator('.wr-step__item', { hasText: name })
  await item('Kitchen Remodel').getByRole('button', { name: 'Keep' }).click()
  await item('Garden Shed').getByRole('button', { name: 'Someday' }).click()
  await expect(vault.getByText('All projects reviewed!')).toBeVisible()
  expect(await projectStatus('Kitchen Remodel')).toBe('active')
  expect(await projectStatus('Garden Shed')).toBe('someday')
  await vault.getByRole('button', { name: 'Next: stale' }).click()
})

test('step 4 backlogs, deletes and keeps the tasks that went stale', async () => {
  const item = (text: string) => vault.locator('.wr-step__item', { hasText: text })
  await item('Sort the receipts').getByRole('button', { name: 'Backlog' }).click()
  await item('Fix the bike').getByRole('button', { name: 'Delete' }).click()
  await item('Call the bank').getByRole('button', { name: 'Keep' }).click()
  await expect(
    vault.getByText('No stale tasks — nice work staying on top of things.')
  ).toBeVisible()

  const backlog = await invokeChannel<{ tasks: { text: string }[] }>(
    vault,
    'task-vault:vault:list-someday'
  )
  expect(backlog.tasks.map((task) => task.text)).toContain('Sort the receipts')
  const fixTheBike = (
    await invokeChannel<{ tasks: { text: string; status: string }[] }>(
      vault,
      'task-vault:vault:query',
      { status: 'cancelled' }
    )
  ).tasks.map((task) => task.text)
  expect(fixTheBike).toContain('Fix the bike')
  const today = await invokeChannel<{ tasks: { text: string; todaySince: string }[] }>(
    vault,
    'task-vault:vault:get-today'
  )
  expect(today.tasks.find((task) => task.text === 'Call the bank')?.todaySince).toBe(localDate(0))
  await vault.getByRole('button', { name: 'Next: someday' }).click()
})

test('step 5 picks up and archives backlog items and promotes a someday project', async () => {
  const item = (text: string) => vault.locator('.wr-step__item', { hasText: text })
  await item('Read the backlog novel').getByRole('button', { name: 'Pick up today' }).click()
  await item('Retire the old laptop').getByRole('button', { name: 'Archive' }).click()
  await item('Learn Piano').getByRole('button', { name: 'Promote to active' }).click()
  await expect(item('Learn Piano')).toHaveCount(0)

  const today = await invokeChannel<{ tasks: { text: string }[] }>(
    vault,
    'task-vault:vault:get-today'
  )
  expect(today.tasks.map((task) => task.text)).toContain('Read the backlog novel')
  expect(await storedTask(vault, 'Retire the old laptop')).toMatchObject({ status: 'cancelled' })
  expect(await projectStatus('Learn Piano')).toBe('active')
  await vault.getByRole('button', { name: 'Next: reflect' }).click()
})

test('step 6 saves the reflection and History shows what the review did', async () => {
  await vault.getByLabel('What worked well?').fill('Mornings without meetings')
  await vault.getByLabel("What didn't work?").fill('Too many open loops')
  await vault.getByLabel('What will you try next week?').fill('A daily shutdown')
  await vault.getByRole('button', { name: 'Finish review' }).click()
  await expect(vault.getByText('Review complete')).toBeVisible()

  await vault.getByRole('button', { name: 'View past reviews' }).click()
  const review = vault.locator('.wr-history__item').first()
  await expect(review).not.toContainText('in progress')
  await review.locator('.wr-history__toggle').click()
  const detail = review.locator('.wr-history__detail')
  await expect(detail).toContainText('Pay the parking fine')
  await expect(detail).toContainText('Garden Shed — someday')
  await expect(detail).toContainText('Sort the receipts')
  await expect(detail).toContainText('Read the backlog novel')
  await expect(detail.locator('.wr-history__reflection')).toContainText('A daily shutdown')
})

test('a past review exports to the markdown file chosen', async () => {
  const file = join(mkdtempSync(join(tmpdir(), 'review-export-')), 'review.md')
  await answerNextSaveDialog(handle, file)
  await vault
    .locator('.wr-history__item')
    .first()
    .getByRole('button', { name: /^Export review from / })
    .click()

  // Until the save lands the file is not there, and a poll whose callback
  // throws stops at once rather than trying again.
  await expect
    .poll(() => (existsSync(file) ? readFileSync(file, 'utf8') : ''), { timeout: 10_000 })
    .toContain('Mornings without meetings')
  expect(readFileSync(file, 'utf8')).toContain('Garden Shed')
})
