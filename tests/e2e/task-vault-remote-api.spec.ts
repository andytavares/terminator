import { test, expect } from '@playwright/test'
import { AppHandle, launchApp, closeApp } from './helpers'
import { invokeChannel, type ExtensionView } from './extension-page'
import { goToSection, openVault, localDate } from './task-vault-harness'

// Remote-accessible channels that no view calls: a remote client is their only
// caller, so they are driven the way it calls them, and their effect is read
// where a user sees it.

let handle: AppHandle
let vault: ExtensionView

test.beforeAll(async () => {
  handle = await launchApp()
  vault = await openVault(handle)
})

test.afterAll(async () => {
  await closeApp(handle)
})

test('projects:update-status shelves a project and its open tasks', async () => {
  await invokeChannel(vault, 'task-vault:projects:create', { name: 'Podcast' })
  await invokeChannel(vault, 'task-vault:vault:add-task', {
    filePath: 'projects/Podcast.md',
    text: 'Record the pilot @Podcast',
  })
  expect(
    await invokeChannel(vault, 'task-vault:projects:update-status', {
      projectFilePath: 'Podcast',
      status: 'someday',
    })
  ).toEqual({ success: true })

  await goToSection(vault, 'Projects')
  await vault.locator('.projects-browser__filter-btn', { hasText: 'All' }).click()
  const card = vault.locator('.projects-browser__card', { hasText: 'Podcast' })
  await expect(card.locator('.projects-browser__someday-badge')).toBeVisible()
  await expect(card.getByRole('button', { name: 'Promote to active' })).toBeVisible()

  await invokeChannel(vault, 'task-vault:projects:update-status', {
    projectFilePath: 'Podcast',
    status: 'archived',
  })
  await expect(card.locator('.projects-browser__archived-badge')).toBeVisible()
  const cancelled = await invokeChannel<{ tasks: { text: string }[] }>(
    vault,
    'task-vault:vault:query',
    { status: 'cancelled', project: 'Podcast' }
  )
  expect(cancelled.tasks.map((task) => task.text)).toEqual(['Record the pilot'])
})

test('vault:query filters by status, context, project, area and due date', async () => {
  for (const text of [
    'Buy paint +errands #Home due:2031-01-10',
    'Call the council +phone #Home due:2031-03-01',
    'Email the editor +computer',
  ]) {
    await invokeChannel(vault, 'task-vault:vault:capture', { text })
  }
  const queryVault = async (filter: Record<string, unknown>) =>
    (
      await invokeChannel<{ tasks: { text: string }[] }>(vault, 'task-vault:vault:query', filter)
    ).tasks.map((task) => task.text)

  // Tags are stored under their display name.
  expect(await queryVault({ context: 'Errands' })).toEqual(['Buy paint'])
  expect(await queryVault({ area: 'Home' })).toEqual(['Buy paint', 'Call the council'])
  expect(await queryVault({ area: 'Home', dueBefore: '2031-02-01' })).toEqual(['Buy paint'])
  expect(await queryVault({ status: ['open'], context: 'Computer' })).toEqual(['Email the editor'])
})

test('settings:set-stale-threshold decides when a rolled-over task reads as stale', async () => {
  await invokeChannel(vault, 'task-vault:vault:add-task', {
    filePath: `daily/${localDate(-8)}.md`,
    text: 'Renew the insurance',
  })
  // Opening the vault afresh rolls last week's open task over to today.
  await vault.reload()
  await goToSection(vault, 'Today')
  const row = vault.locator('.daily-log__task', { hasText: 'Renew the insurance' })
  // Eight days over the default threshold of seven.
  await expect(row.locator('.daily-log__stale-badge')).toBeVisible()

  await invokeChannel(vault, 'task-vault:settings:set-stale-threshold', { days: 14 })
  await vault.reload()
  await expect(row).toBeVisible()
  await expect(row.locator('.daily-log__stale-badge')).toHaveCount(0)
})
