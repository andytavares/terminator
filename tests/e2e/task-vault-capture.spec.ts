import { test, expect, type Locator, type TestStepInfo } from '@playwright/test'
import { AppHandle, launchApp, closeApp } from './helpers'
import { invokeChannel, type ExtensionView } from './extension-page'
import { goToSection, openVault, storedTask, type StoredTask } from './task-vault-harness'
import { canPressGlobalKeys, pressGlobalChord } from './x11-keys'
import { expectCentredInWindow } from './modal-centre'

// Capturing into the Task Vault inbox and clarifying what was captured, the
// GTD loop the inbox exists for. Each step drives the view the way a user does
// and reads back what the vault stored; the steps run in order and build on
// each other's inbox.

let handle: AppHandle
let vault: ExtensionView

test.beforeAll(async () => {
  handle = await launchApp()
  vault = await openVault(handle)
})

test.afterAll(async () => {
  await closeApp(handle)
})

async function inboxTexts(): Promise<string[]> {
  const result = await invokeChannel<{ tasks: StoredTask[] }>(vault, 'task-vault:vault:get-inbox')
  return result.tasks.map((task) => task.text)
}

async function captureFromInbox(text: string): Promise<void> {
  const input = vault.locator('.inbox-view__capture input')
  await input.fill(text)
  await vault.locator('.inbox-view__capture').getByRole('button', { name: 'Capture' }).click()
  await expect(vault.locator('.inbox-item__text', { hasText: text })).toBeVisible()
}

function inboxRow(text: string) {
  return vault.locator('.inbox-item').filter({ hasText: text })
}

/** An item captured in the inbox is listed, counted and stored. */
async function captureIntoInbox(): Promise<void> {
  await goToSection(vault, 'Inbox')
  await captureFromInbox('Call the plumber')

  await expect(vault.locator('.inbox-view__count')).toHaveText('1 item')
  await expect(vault.locator('.vault-sidebar__badge')).toHaveText('1')
  expect(await inboxTexts()).toEqual(['Call the plumber'])
}

/** Editing an inbox item rewrites its text and parses its tags. */
async function editInboxItem(): Promise<void> {
  await inboxRow('Call the plumber').locator('.inbox-item__text').dblclick()
  const editor = vault.locator('.inbox-item__edit input')
  await editor.fill('Call the plumber about the leak due:2031-05-04')
  await vault.locator('.inbox-item__edit').getByRole('button', { name: 'Save' }).click()

  await expect(inboxRow('Call the plumber about the leak')).toContainText('due:2031-05-04')
  expect(await inboxTexts()).toEqual(['Call the plumber about the leak'])
}

/** Moving an item to the backlog takes it out of the inbox. */
async function moveToBacklog(): Promise<void> {
  await captureFromInbox('Learn the cello')
  await inboxRow('Learn the cello').getByRole('button', { name: 'Move to backlog' }).click()

  await expect(inboxRow('Learn the cello')).toHaveCount(0)
  const backlog = await invokeChannel<{ tasks: StoredTask[] }>(
    vault,
    'task-vault:vault:list-someday'
  )
  expect(backlog.tasks.map((task) => task.text)).toContain('Learn the cello')
}

/** Deleting an inbox item asks first, then removes it for good. */
async function deleteAfterConfirm(): Promise<void> {
  await captureFromInbox('Junk mail')
  handle.page.once('dialog', (dialog) => void dialog.accept())
  await inboxRow('Junk mail').getByRole('button', { name: 'Delete' }).click()

  await expect(inboxRow('Junk mail')).toHaveCount(0)
  expect(await storedTask(vault, 'Junk mail')).toBeUndefined()
}

/** Answers the clarify questions for each of the five inbox items, in the order they come. */
async function clarifyEachItem(processor: Locator): Promise<void> {
  // The edited item from earlier comes first: file it under a new area.
  await expect(processor.locator('.inbox-processor__text')).toHaveText(
    'Call the plumber about the leak'
  )
  await processor.getByRole('button', { name: 'Yes' }).click()
  await processor.getByRole('button', { name: 'No — File it' }).click()
  await processor.getByPlaceholder('Search or create project / area…').fill('Home')
  await processor.getByText('Create area "Home"').click()

  await expect(processor.locator('.inbox-processor__text')).toHaveText('Old flyer')
  await processor.getByRole('button', { name: 'Trash it' }).click()

  await expect(processor.locator('.inbox-processor__text')).toHaveText('Write a novel')
  await processor.getByRole('button', { name: 'Incubate — Backlog' }).click()

  await expect(processor.locator('.inbox-processor__text')).toHaveText('Reply to Sam')
  await processor.getByRole('button', { name: 'Yes' }).click()
  await processor.getByRole('button', { name: 'Do now — Today' }).click()

  await expect(processor.locator('.inbox-processor__text')).toHaveText('Draft the budget')
  await processor.getByRole('button', { name: 'Yes' }).click()
  await processor.getByRole('button', { name: 'No — File it' }).click()
  await processor.getByPlaceholder('Search or create project / area…').fill('Finances')
  await processor.getByText('Create project "Finances"').click()
}

/** Clarifying the inbox trashes, incubates, does now and files each item. */
async function clarifyInbox(): Promise<void> {
  for (const text of ['Old flyer', 'Write a novel', 'Reply to Sam', 'Draft the budget']) {
    await captureFromInbox(text)
  }
  await vault.getByRole('button', { name: 'Process inbox (GTD clarify)' }).click()
  const processor = vault.locator('.inbox-processor')

  await clarifyEachItem(processor)

  // Done with the last item, the view goes back to today's log.
  await expect(vault.locator('.daily-log')).toBeVisible()
  await expect(vault.locator('.daily-log__task-text', { hasText: 'Reply to Sam' })).toBeVisible()
  expect(await inboxTexts()).toEqual([])

  expect(await storedTask(vault, 'Call the plumber about the leak')).toMatchObject({ area: 'Home' })
  expect(await storedTask(vault, 'Old flyer')).toMatchObject({ status: 'cancelled' })
  expect(await storedTask(vault, 'Reply to Sam')).toMatchObject({ status: 'in-progress' })
  expect(await storedTask(vault, 'Draft the budget')).toMatchObject({ project: 'Finances' })
  const backlog = await invokeChannel<{ tasks: StoredTask[] }>(
    vault,
    'task-vault:vault:list-someday'
  )
  expect(backlog.tasks.map((task) => task.text)).toContain('Write a novel')
}

/** Capture to inbox from Quick Actions saves what was typed. */
async function captureFromQuickActions(): Promise<void> {
  await handle.page.bringToFront()
  // The clarify run ends with focus inside the vault's frame, which the
  // host's ⌘P listener cannot hear; blur it so the panel opens.
  await handle.page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur())
  await handle.page.keyboard.press('ControlOrMeta+p')
  await handle.page.keyboard.press('v')
  await handle.page.keyboard.press('c')

  const dialog = vault.getByRole('dialog', { name: 'Capture to Inbox' })
  await expect(dialog).toBeVisible({ timeout: 15_000 })
  await expectCentredInWindow(dialog, 'Task Vault: Capture to Inbox')
  await dialog.getByRole('textbox').fill('Buy stamps')
  await dialog.getByRole('textbox').press('Enter')

  await expect(dialog).toHaveCount(0)
  expect(await inboxTexts()).toEqual(['Buy stamps'])
  await expect(vault.locator('.vault-sidebar__badge')).toHaveText('1')
}

/** The global capture shortcut opens the capture overlay from any window. */
async function captureByGlobalShortcut(step: TestStepInfo): Promise<void> {
  step.skip(
    !canPressGlobalKeys,
    'pressing a system-wide chord needs an X server; macOS needs Accessibility consent for the runner'
  )
  // Focus is in the main window, not the vault: the shortcut is global.
  await handle.page.bringToFront()
  pressGlobalChord('Control_L', 'Shift_L', 'o')

  const dialog = vault.getByRole('dialog', { name: 'Capture to Inbox' })
  await expect(dialog).toBeVisible({ timeout: 15_000 })
  await dialog.getByRole('textbox').fill('Renew the passport')
  await dialog.getByRole('button', { name: /Capture/ }).click()

  await expect(dialog).toHaveCount(0)
  expect(await inboxTexts()).toContain('Renew the passport')
}

const THE_INBOX_LOOP: [string, (step: TestStepInfo) => Promise<void>][] = [
  ['an item captured in the inbox is listed, counted and stored', captureIntoInbox],
  ['editing an inbox item rewrites its text and parses its tags', editInboxItem],
  ['moving an item to the backlog takes it out of the inbox', moveToBacklog],
  ['deleting an inbox item asks first, then removes it for good', deleteAfterConfirm],
  ['clarifying the inbox trashes, incubates, does now and files each item', clarifyInbox],
  ['Capture to inbox from Quick Actions saves what was typed', captureFromQuickActions],
  [
    'the global capture shortcut opens the capture overlay from any window',
    captureByGlobalShortcut,
  ],
]

// CI's X11 job runs this file by name for the global shortcut step (.github/workflows/ci.yml).
test('the inbox is captured into, clarified and captured into again', async () => {
  for (const [title, step] of THE_INBOX_LOOP) await test.step(title, step)
})
