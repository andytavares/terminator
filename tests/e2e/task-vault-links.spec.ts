import { test, expect } from '@playwright/test'
import {
  AppHandle,
  addAndSelectProject,
  closeApp,
  createWorkspace,
  launchApp,
  projectGroup,
} from './helpers'
import { invokeChannel, type ExtensionView } from './extension-page'
import {
  dailyLogTaskRow,
  openVault,
  pressRowAction,
  storedTask,
  type StoredTask,
} from './task-vault-harness'

// Linking tasks and projects to terminal sessions, and jumping from a task to
// the terminal it is linked to. The steps run in order on one task and one
// project. The remote API's link channels are covered by
// extensions/task-vault/tests/ipc/links.ipc.spec.ts.

let handle: AppHandle
let vault: ExtensionView

/** Picks the option naming the alpha branch in a terminal picker. */
async function pickAlpha(select: ReturnType<ExtensionView['locator']>): Promise<void> {
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

/** A task is linked to the terminal picked for it. */
async function linkTaskToTerminal(): Promise<void> {
  await pressRowAction(
    dailyLogTaskRow(vault, 'Deploy the fix').getByRole('button', {
      name: 'Link to terminal session',
    })
  )
  await pickAlpha(vault.locator('.daily-log__link-picker select'))

  await dailyLogTaskRow(vault, 'Deploy the fix').hover()
  await expect(
    dailyLogTaskRow(vault, 'Deploy the fix').getByRole('button', {
      name: 'Jump to linked terminal',
    })
  ).toBeVisible()
  const stored = (await storedTask(vault, 'Deploy the fix')) as StoredTask & {
    terminatorLinks: string[]
  }
  expect(stored.terminatorLinks).toHaveLength(1)
}

/** Jumping from the task brings its terminal forward. */
async function jumpToTerminal(): Promise<void> {
  await expect(projectGroup(handle.page, 'beta')).toHaveClass(/branch-row--selected/)
  await pressRowAction(
    dailyLogTaskRow(vault, 'Deploy the fix').getByRole('button', {
      name: 'Jump to linked terminal',
    })
  )

  await expect(projectGroup(handle.page, 'alpha')).toHaveClass(/branch-row--selected/)
}

/** A project is linked to a terminal from its card. */
async function linkProjectToTerminal(): Promise<void> {
  // The jump test left the terminal on screen; the vault's frame unmounted
  // with its global tab, so this is a new frame at the same URL.
  vault = await openVault(handle)
  await vault
    .locator('.vault-sidebar')
    .getByRole('button', { name: 'Projects', exact: true })
    .click()
  const card = vault.locator('.projects-browser__card', { hasText: 'Release' })
  await card.getByRole('button', { name: 'Link…' }).click()
  await pickAlpha(card.locator('.projects-browser__link-picker select'))

  await expect(card.getByTitle('Linked')).toBeVisible()
}

const LINK_AND_JUMP: [string, () => Promise<void>][] = [
  ['a task is linked to the terminal picked for it', linkTaskToTerminal],
  ['jumping from the task brings its terminal forward', jumpToTerminal],
  ['a project is linked to a terminal from its card', linkProjectToTerminal],
]

test('a task and a project are linked to a terminal, and the task jumps to it', async () => {
  for (const [title, step] of LINK_AND_JUMP) await test.step(title, step)
})
