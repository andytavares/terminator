import { expect, type Page } from '@playwright/test'
import type { AppHandle } from './helpers'
import { invokeChannel, openExtension } from './extension-page'

// Shared by the tests/e2e/task-vault-*.spec.ts files: opening the vault, moving
// between its sections, and reading back what an action stored.

export interface StoredTask {
  id: string
  text: string
  status: string
  project: string | null
  area: string | null
  context: string | null
  dueDate: string | null
  blockedReason: string | null
  recurrenceRule: string | null
  todaySince: string | null
  subtasks?: StoredTask[]
}

const VAULT_URL = 'terminator.task-vault/dist/index.html?view=main'

/** Opens Task Vault from the app band and waits for its navigation. */
export async function openVault(handle: AppHandle): Promise<Page> {
  const vault = await openExtension(handle, 'Task Vault', VAULT_URL)
  await expect(vault.locator('.vault-sidebar')).toBeVisible({ timeout: 20_000 })
  return vault
}

/** Clicks a section in the vault's own sidebar: Today, Inbox, Projects, Areas, History or Weekly review. */
export async function goTo(vault: Page, section: string): Promise<void> {
  await vault.locator('.vault-sidebar').getByRole('button', { name: section, exact: true }).click()
}

/** Every task the vault holds, whatever its status. */
export async function allTasks(vault: Page): Promise<StoredTask[]> {
  const result = await invokeChannel<{ tasks: StoredTask[] }>(vault, 'task-vault:vault:query', {})
  return result.tasks
}

/** The stored task with exactly this text, if there is one. */
export async function storedTask(vault: Page, text: string): Promise<StoredTask | undefined> {
  return (await allTasks(vault)).find((task) => task.text === text)
}

/** Today's open log, as the vault stores it. */
export async function todayTasks(vault: Page): Promise<StoredTask[]> {
  const result = await invokeChannel<{ tasks: StoredTask[] }>(vault, 'task-vault:vault:get-today')
  return result.tasks
}
