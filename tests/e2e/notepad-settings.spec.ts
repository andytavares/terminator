import { test, expect, type Page } from '@playwright/test'
import { AppHandle, launchApp, closeApp, closeSettingsPanel } from './helpers'
import { openExtensionSettings, settingRow } from './extension-settings-page'
import { createItem, noteRow, openNotepad, storedNote } from './notepad-harness'

// Notepad's editor settings, changed on its settings page and seen in the
// notes: the editor's text size, and how long typing must pause before a note
// is saved. The view reads them again whenever a setting changes.

let handle: AppHandle
let notepad: Page

test.describe.configure({ mode: 'serial' })

test.beforeAll(async () => {
  handle = await launchApp()
  notepad = await openNotepad(handle)
  await createItem(notepad, 'Note', 'Settings')
  await noteRow(notepad, 'Settings').click()
})

test.afterAll(async () => {
  await closeApp(handle)
})

async function changeNotepadSetting(label: string, value: string): Promise<void> {
  const page = await openExtensionSettings(handle.page, 'Notepad')
  await settingRow(page, label).locator('input').fill(value)
  await closeSettingsPanel(handle.page)
  await notepad.locator('.notepad-view__editor .cm-content').click()
}

const fontSize = () =>
  notepad
    .locator('.notepad-view__editor .cm-scroller')
    .evaluate((el) => getComputedStyle(el).fontSize)

test('"Editor font size" sets the size of the text in the editor', async () => {
  expect(await fontSize()).toBe('14px')
  await changeNotepadSetting('Editor font size', '18')
  await expect.poll(fontSize).toBe('18px')
})

test('"Autosave debounce" is how long typing must pause before the note is saved', async () => {
  await changeNotepadSetting('Autosave debounce', '3000')
  await notepad.keyboard.press('ControlOrMeta+End')
  // A note's title follows its first heading, so the body opens with one.
  await notepad.keyboard.type('# Settings\nwaited')
  const typedAt = Date.now()

  await expect(notepad.locator('.notepad-view__save-status')).toHaveText('Saved', {
    timeout: 10_000,
  })
  // The default of 800 ms would have saved within about a second.
  expect(Date.now() - typedAt).toBeGreaterThanOrEqual(2500)
  expect((await storedNote(notepad, 'Settings'))?.body).toContain('waited')
})
