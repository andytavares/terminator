import { test, expect, type Page } from '@playwright/test'
import {
  AppHandle,
  addAndSelectProject,
  closeApp,
  createWorkspace,
  launchApp,
  projectGroup,
} from './helpers'
import { invokeChannel } from './extension-page'
import { openVault, storedTask, type StoredTask } from './task-vault-harness'

// Linking tasks and projects to terminal sessions, and jumping from a task to
// the terminal it is linked to. The remote API's two link channels, which no
// view calls, are driven the way a remote client calls them.

let handle: AppHandle
let vault: Page
/** The session the task was linked to, as the vault stored it. */
let alphaSessionId: string

/** Picks the option naming the alpha branch in a terminal picker. */
async function pickAlpha(select: ReturnType<Page['locator']>): Promise<void> {
  const label = (await select.locator('option', { hasText: 'alpha' }).textContent()) ?? ''
  await select.selectOption({ label })
}

test.beforeAll(async () => {
  handle = await launchApp()
  await createWorkspace(handle.page, 'Vault Links', handle.userDataDir)
  await addAndSelectProject(handle.page, 'Vault Links', 'alpha')
  await addAndSelectProject(handle.page, 'Vault Links', 'beta')
  vault = await openVault(handle)
  await invokeChannel(vault, 'task-vault:projects:create', { name: 'Release' })
  await vault.getByRole('button', { name: 'Add task', exact: true }).click()
  await vault.locator('.daily-log__add-row input').fill('Deploy the fix')
  await vault.locator('.daily-log__add-row input').press('Enter')
  await expect(vault.locator('.daily-log__add-row')).toHaveCount(0)
})

test.afterAll(async () => {
  await closeApp(handle)
})

function taskRow(text: string) {
  return vault.locator('.daily-log__task').filter({ has: vault.getByText(text, { exact: true }) })
}

test('a task is linked to the terminal picked for it', async () => {
  await taskRow('Deploy the fix').hover()
  await taskRow('Deploy the fix').getByRole('button', { name: 'Link to terminal session' }).click()
  await pickAlpha(vault.locator('.daily-log__link-picker select'))

  await taskRow('Deploy the fix').hover()
  await expect(
    taskRow('Deploy the fix').getByRole('button', { name: 'Jump to linked terminal' })
  ).toBeVisible()
  const stored = (await storedTask(vault, 'Deploy the fix')) as StoredTask & {
    terminatorLinks: string[]
  }
  expect(stored.terminatorLinks).toHaveLength(1)
  alphaSessionId = stored.terminatorLinks[0]
})

test('jumping from the task brings its terminal forward', async () => {
  await expect(projectGroup(handle.page, 'beta')).toHaveClass(/branch-row--selected/)
  await taskRow('Deploy the fix').hover()
  await taskRow('Deploy the fix').getByRole('button', { name: 'Jump to linked terminal' }).click()

  await expect(projectGroup(handle.page, 'alpha')).toHaveClass(/branch-row--selected/)
})

test('a project is linked to a terminal from its card', async () => {
  await vault
    .locator('.vault-sidebar')
    .getByRole('button', { name: 'Projects', exact: true })
    .click()
  const card = vault.locator('.projects-browser__card', { hasText: 'Release' })
  await card.getByRole('button', { name: 'Link…' }).click()
  await pickAlpha(card.locator('.projects-browser__link-picker select'))

  await expect(card.getByTitle('Linked')).toBeVisible()
})

test('the remote API lists what a terminal is linked to, and unlinks a task', async () => {
  const linked = await invokeChannel<{ tasks: { text: string }[]; projects: { name: string }[] }>(
    vault,
    'task-vault:links:get-for-terminator-target',
    { targetId: alphaSessionId }
  )
  expect(linked.tasks.map((task) => task.text)).toEqual(['Deploy the fix'])
  expect(linked.projects.map((project) => project.name)).toEqual(['Release'])

  const task = (await storedTask(vault, 'Deploy the fix')) as StoredTask
  await invokeChannel(vault, 'task-vault:links:remove', {
    taskId: task.id,
    targetId: alphaSessionId,
  })
  await invokeChannel(vault, 'task-vault:links:remove', {
    projectFilePath: 'Release',
    targetId: alphaSessionId,
  })

  const after = await invokeChannel<{ tasks: unknown[]; projects: unknown[] }>(
    vault,
    'task-vault:links:get-for-terminator-target',
    { targetId: alphaSessionId }
  )
  expect(after).toEqual({ tasks: [], projects: [] })
  await vault.locator('.vault-sidebar').getByRole('button', { name: 'Today', exact: true }).click()
  await taskRow('Deploy the fix').hover()
  await expect(
    taskRow('Deploy the fix').getByRole('button', { name: 'Link to terminal session' })
  ).toBeVisible()
})
