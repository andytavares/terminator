import { expect, type Locator } from '@playwright/test'
import type { AppHandle } from './helpers'
import { invokeChannel, openFromAppBand, type ExtensionView } from './extension-page'

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

/** The local date `offsetDays` from today, as the vault names a daily log: YYYY-MM-DD. */
export function localDate(offsetDays = 0): string {
  const date = new Date()
  date.setDate(date.getDate() + offsetDays)
  const zeroPadded = (n: number) => String(n).padStart(2, '0')
  return `${date.getFullYear()}-${zeroPadded(date.getMonth() + 1)}-${zeroPadded(date.getDate())}`
}

/** Opens Task Vault from the app band and waits for its navigation. */
export async function openVault(handle: AppHandle): Promise<ExtensionView> {
  const vault = await openFromAppBand(handle, 'Task Vault', VAULT_URL)
  await expect(vault.locator('.vault-sidebar')).toBeVisible()
  return vault
}

/** Clicks a section in the vault's own sidebar: Today, Inbox, Projects, Areas or History. */
export async function goToSection(vault: ExtensionView, section: string): Promise<void> {
  await vault.locator('.vault-sidebar').getByRole('button', { name: section, exact: true }).click()
}

/** Every task the vault holds, whatever its status. */
export async function allTasks(vault: ExtensionView): Promise<StoredTask[]> {
  const result = await invokeChannel<{ tasks: StoredTask[] }>(vault, 'task-vault:vault:query', {})
  return result.tasks
}

/** The stored task with exactly this text, if there is one. */
export async function storedTask(
  vault: ExtensionView,
  text: string
): Promise<StoredTask | undefined> {
  return (await allTasks(vault)).find((task) => task.text === text)
}

/** Today's open log, as the vault stores it. */
export async function todayTasks(vault: ExtensionView): Promise<StoredTask[]> {
  const result = await invokeChannel<{ tasks: StoredTask[] }>(vault, 'task-vault:vault:get-today')
  return result.tasks
}

/** A task row of the open daily log, found by its exact text. */
export function dailyLogTaskRow(vault: ExtensionView, text: string) {
  return vault.locator('.daily-log__task').filter({ has: vault.getByText(text, { exact: true }) })
}

/** Presses an action a row shows on hover or keyboard focus. Focus, not hover: with several apps
 * open at once, Chromium sends each a pointer move to where the real cursor rests whenever a
 * view's layout changes, which ended a hover between Playwright's hover and its click. */
export async function pressRowAction(action: Locator): Promise<void> {
  await action.focus()
  await action.click()
}
