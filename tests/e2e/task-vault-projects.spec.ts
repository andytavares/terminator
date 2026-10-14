import { test, expect, type Page } from '@playwright/test'
import { AppHandle, launchApp, closeApp } from './helpers'
import { invokeChannel } from './extension-page'
import { goToSection, openVault, storedTask } from './task-vault-harness'

// Projects, areas and the history of what was archived: creating, renaming,
// filing tasks under them, archiving, restoring and deleting, each through the
// vault's own screens and read back from what it stored.

interface StoredProject {
  name: string
  status: string
  area: string | null
  deadline: string | null
  outcome?: string | null
}

interface StoredArea {
  name: string
  status: string
}

let handle: AppHandle
let vault: Page

test.beforeAll(async () => {
  handle = await launchApp()
  vault = await openVault(handle)
})

test.afterAll(async () => {
  await closeApp(handle)
})

async function projects(): Promise<StoredProject[]> {
  const result = await invokeChannel<{ projects: StoredProject[] }>(
    vault,
    'task-vault:projects:list',
    { status: ['active', 'someday', 'archived'] }
  )
  return result.projects
}

async function storedProject(name: string): Promise<StoredProject | undefined> {
  return (await projects()).find((candidate) => candidate.name === name)
}

async function areas(): Promise<StoredArea[]> {
  const result = await invokeChannel<{ areas: StoredArea[] }>(
    vault,
    'task-vault:vault:list-areas',
    {
      status: 'all',
    }
  )
  return result.areas
}

function projectCard(name: string) {
  return vault
    .locator('.projects-browser__card')
    .filter({ has: vault.locator('.projects-browser__name').getByText(name, { exact: true }) })
}

function areaCard(name: string) {
  return vault
    .locator('.areas-view__card')
    .filter({ has: vault.locator('.areas-view__card-name').getByText(name, { exact: true }) })
}

test('a project created with an outcome, a new area and a deadline is listed', async () => {
  await goToSection(vault, 'Projects')
  await vault.getByRole('button', { name: '+ New project' }).click()
  const form = vault.locator('.create-project-form')
  await form.getByPlaceholder('Project name').fill('Launch the website')
  await form.getByPlaceholder('What does done look like?').fill('Live on the new domain')
  await form.getByPlaceholder('e.g. work').fill('Marketing')
  await form.locator('.dtp__trigger').click()
  await vault.locator('.dtp__popover').getByRole('button', { name: 'Tomorrow' }).click()
  await form.getByRole('button', { name: 'Create project' }).click()

  await expect(projectCard('Launch The Website')).toContainText('#Marketing')
  await expect(projectCard('Launch The Website')).toContainText('due:')
  expect(await storedProject('Launch The Website')).toMatchObject({
    status: 'active',
    area: 'Marketing',
  })
  expect((await areas()).map((area) => area.name)).toContain('Marketing')
})

test("a project's tasks are added, edited, completed and reopened from its card", async () => {
  const card = projectCard('Launch The Website')
  await card.getByRole('button', { name: 'Show tasks tagged @Launch The Website' }).click()
  const input = card.getByPlaceholder('Add task to @Launch The Website…')
  await input.fill('Write the landing copy')
  await card.getByRole('button', { name: 'Add', exact: true }).click()
  await expect(card.locator('.projects-browser__task-text')).toHaveText(['Write the landing copy'])
  expect(await storedTask(vault, 'Write the landing copy')).toMatchObject({
    project: 'Launch The Website',
  })

  await card.locator('.projects-browser__task-text').dblclick()
  await card
    .locator('.projects-browser__task-edit input')
    .fill('Write the hero copy @Launch-The-Website')
  await card.locator('.projects-browser__task-edit').getByRole('button', { name: 'Save' }).click()
  await expect(card.locator('.projects-browser__task-text')).toHaveText(['Write the hero copy'])

  await card.getByTitle('Complete').click()
  await expect(card.locator('.projects-browser__done-tasks summary')).toHaveText(
    '1 completed/cancelled'
  )
  expect(await storedTask(vault, 'Write the hero copy')).toMatchObject({ status: 'done' })

  await card.locator('.projects-browser__done-tasks summary').click()
  await card.locator('.projects-browser__task-row--done').hover()
  await card.getByTitle("Reopen on today's log").click()
  await expect(card.locator('.projects-browser__done-tasks')).toHaveCount(0)
  expect(await storedTask(vault, 'Write the hero copy')).toMatchObject({ status: 'open' })
})

test('a project is renamed, moved to another area and its deadline cleared', async () => {
  const card = projectCard('Launch The Website')
  await card.getByRole('button', { name: 'Rename project' }).click()
  // While renaming, the card shows an input in place of its name.
  const renameRow = vault.locator('.projects-browser__rename-row')
  await renameRow.locator('input').fill('Launch the new website')
  await renameRow.getByRole('button', { name: 'Save', exact: true }).click()
  await expect(projectCard('Launch the new website')).toBeVisible()
  expect(await storedProject('Launch The Website')).toBeUndefined()

  const renamed = projectCard('Launch the new website')
  await renamed.getByRole('button', { name: 'Change area' }).click()
  await renamed.getByPlaceholder('e.g. work').fill('Engineering')
  await renamed.getByRole('button', { name: 'Save area' }).click()
  await expect(renamed).toContainText('#Engineering')
  expect(await storedProject('Launch the new website')).toMatchObject({ area: 'Engineering' })

  await renamed.getByTitle('Edit deadline').click()
  await renamed.getByRole('button', { name: 'Clear', exact: true }).click()
  await expect(renamed.getByTitle('Set deadline')).toBeVisible()
  expect(await storedProject('Launch the new website')).toHaveProperty('deadline', undefined)

  await renamed.getByTitle('Set deadline').click()
  await renamed.locator('.dtp__trigger').click()
  await vault.locator('.dtp__popover').getByRole('button', { name: '1 week' }).click()
  await renamed.getByRole('button', { name: 'Save', exact: true }).click()
  await expect(renamed.getByTitle('Edit deadline')).toBeVisible()
  expect((await storedProject('Launch the new website'))?.deadline).toMatch(/^\d{4}-\d{2}-\d{2}$/)
})

test('an archived project is restored from History, archived again and deleted', async () => {
  await projectCard('Launch the new website')
    .getByRole('button', { name: 'Archive project' })
    .click()
  await expect(projectCard('Launch the new website')).toHaveCount(0)
  expect(await storedProject('Launch the new website')).toMatchObject({ status: 'archived' })

  await goToSection(vault, 'History')
  await vault.getByRole('tab', { name: /Archived projects/ }).click()
  const archived = vault.locator('.archive-view__project-card', {
    hasText: 'Launch the new website',
  })
  await archived.getByRole('button', { name: 'Restore to active' }).click()
  await expect(archived).toHaveCount(0)
  expect(await storedProject('Launch the new website')).toMatchObject({ status: 'active' })

  await goToSection(vault, 'Projects')
  await projectCard('Launch the new website')
    .getByRole('button', { name: 'Archive project' })
    .click()
  await vault.locator('.projects-browser__filter-btn', { hasText: 'Archived' }).click()
  vault.once('dialog', (dialog) => void dialog.accept())
  await projectCard('Launch the new website')
    .getByRole('button', { name: 'Delete project' })
    .click()
  await expect(projectCard('Launch the new website')).toHaveCount(0)
  expect(await storedProject('Launch the new website')).toBeUndefined()
  expect(await storedTask(vault, 'Write the hero copy')).toBeUndefined()
})

/** Creates the Health area and gives it a task. */
async function createHealthAreaWithTask(): Promise<void> {
  await goToSection(vault, 'Areas')
  await vault.getByRole('button', { name: '+ New area' }).click()
  await vault.getByPlaceholder('Area name (e.g. health, finances, work)').fill('Health')
  await vault.getByRole('button', { name: 'Create', exact: true }).click()
  await expect(areaCard('Health')).toBeVisible()

  await areaCard('Health').click()
  await vault.getByPlaceholder('Add task to this area…').fill('Book a check-up')
  await vault.getByPlaceholder('Add task to this area…').press('Enter')
  await expect(vault.getByText('Book a check-up', { exact: true })).toBeVisible()
  expect(await storedTask(vault, 'Book a check-up')).toMatchObject({ area: 'Health' })
}

/** Edits the area's task, completes it, and adds another. */
async function editAndCompleteAreaTask(): Promise<void> {
  await vault.locator('.area-detail__task-text', { hasText: 'Book a check-up' }).dblclick()
  await vault.locator('.area-detail__task-edit input').fill('Book a dental check-up #Health')
  await vault.locator('.area-detail__task-edit').getByRole('button', { name: 'Save' }).click()
  await expect(vault.locator('.area-detail__task-text')).toHaveText(['Book a dental check-up'])

  // The area lists what is still to do: a finished task leaves it for History.
  await vault.getByTitle('Complete').click()
  await expect(vault.locator('.area-detail__task-text')).toHaveCount(0)
  expect(await storedTask(vault, 'Book a dental check-up')).toMatchObject({ status: 'done' })
  await vault.getByPlaceholder('Add task to this area…').fill('Walk every day')
  await vault.getByPlaceholder('Add task to this area…').press('Enter')
  await expect(vault.locator('.area-detail__task-text')).toHaveText(['Walk every day'])
}

/** Renames Health to Wellbeing, then archives it. */
async function renameAndArchiveArea(): Promise<void> {
  await vault.getByRole('button', { name: 'Rename area' }).click()
  await vault.locator('.area-detail__rename-input').fill('Wellbeing')
  await vault.locator('.area-detail__rename-input').press('Enter')
  // A renamed area is a different entry in the list, so the view returns to it.
  await expect(areaCard('Wellbeing')).toBeVisible()
  expect((await areas()).map((area) => area.name)).toContain('Wellbeing')
  expect(await storedTask(vault, 'Walk every day')).toMatchObject({ area: 'Wellbeing' })

  vault.once('dialog', (dialog) => void dialog.accept())
  await areaCard('Wellbeing').getByRole('button', { name: 'Archive area' }).click()
  await expect
    .poll(async () => (await areas()).find((a) => a.name === 'Wellbeing')?.status)
    .toBe('archived')
  expect(await storedTask(vault, 'Walk every day')).toMatchObject({ status: 'cancelled' })
}

/** Restores Wellbeing from History. */
async function restoreArchivedArea(): Promise<void> {
  await goToSection(vault, 'History')
  await vault.getByRole('tab', { name: /Archived areas/ }).click()
  const archived = vault.locator('.archive-view__project-card', { hasText: 'Wellbeing' })
  await archived.getByRole('button', { name: 'Restore to active' }).click()
  await expect(archived).toHaveCount(0)
  expect((await areas()).find((area) => area.name === 'Wellbeing')).toMatchObject({
    status: 'active',
  })
  expect(await storedTask(vault, 'Walk every day')).toMatchObject({ status: 'open' })
}

/** Archives Wellbeing again, and deletes it for good. */
async function deleteArchivedArea(): Promise<void> {
  await goToSection(vault, 'Areas')
  vault.once('dialog', (dialog) => void dialog.accept())
  await areaCard('Wellbeing').getByRole('button', { name: 'Archive area' }).click()
  await vault.locator('.projects-browser__filter-btn', { hasText: 'Archived' }).click()
  vault.once('dialog', (dialog) => void dialog.accept())
  await areaCard('Wellbeing').getByRole('button', { name: 'Delete area permanently' }).click()
  await expect(areaCard('Wellbeing')).toHaveCount(0)
  expect((await areas()).map((area) => area.name)).not.toContain('Wellbeing')
}

test('an area is created, given a task, renamed, archived, restored and deleted', async () => {
  await createHealthAreaWithTask()
  await editAndCompleteAreaTask()
  await renameAndArchiveArea()
  await restoreArchivedArea()
  await deleteArchivedArea()
})

test('History restores a finished task and deletes another for good', async () => {
  // Deleting the project took its tasks with it, so the day starts empty.
  await goToSection(vault, 'Today')
  await vault.getByRole('button', { name: 'Add task', exact: true }).click()
  for (const text of ['Return the library books', 'Fix the gate']) {
    if (text === 'Fix the gate') await vault.locator('.daily-log__add-btn').click()
    await vault.locator('.daily-log__add-row input').fill(text)
    await vault.locator('.daily-log__add-row input').press('Enter')
    await expect(vault.locator('.daily-log__add-row')).toHaveCount(0)
    await vault
      .locator('.daily-log__task', { hasText: text })
      .getByRole('button', { name: 'Complete task' })
      .click()
  }

  await goToSection(vault, 'History')
  await vault.getByRole('tab', { name: /Completed tasks/ }).click()
  const archiveRow = (text: string) => vault.locator('.archive-task', { hasText: text })
  await archiveRow('Return the library books')
    .getByRole('button', { name: 'Restore to open' })
    .click()
  await expect(archiveRow('Return the library books')).toHaveCount(0)
  expect(await storedTask(vault, 'Return the library books')).toMatchObject({ status: 'open' })

  vault.once('dialog', (dialog) => void dialog.accept())
  await archiveRow('Fix the gate').getByRole('button', { name: 'Delete permanently' }).click()
  await expect(archiveRow('Fix the gate')).toHaveCount(0)
  expect(await storedTask(vault, 'Fix the gate')).toBeUndefined()
})
