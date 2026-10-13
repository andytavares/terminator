import { expect, type Page } from '@playwright/test'
import type { AppHandle } from './helpers'
import { invokeChannel, openExtension } from './extension-page'

// Shared by the tests/e2e/notepad-*.spec.ts files: opening Notepad, creating
// items through its New dialog, and reading back what it stored.

export interface StoredNote {
  id: string
  title: string
  body?: string
  tags: string[]
  folderId: string | null
  archivedAt: string | null
}

const NOTEPAD_URL = 'terminator.notepad/dist/index.html?view=main'

/** Opens Notepad from the app band and waits for it to render. */
export async function openNotepad(handle: AppHandle): Promise<Page> {
  const notepad = await openExtension(handle, 'Notes', NOTEPAD_URL)
  await expect(notepad.locator('.notepad-view')).toBeVisible({ timeout: 20_000 })
  return notepad
}

/** Creates a note, diagram or folder through the New dialog, as a user does. */
export async function createItem(
  notepad: Page,
  kind: 'Note' | 'Diagram' | 'Folder',
  title: string
): Promise<void> {
  const newButton = notepad.getByRole('button', { name: /^New/ }).first()
  await newButton.click()
  const dialog = notepad.locator('.notepad-quick-create')
  await dialog.getByRole('radio', { name: kind }).click()
  await dialog.getByPlaceholder('Title').fill(title)
  await dialog.getByRole('button', { name: /^Save/ }).click()
  await expect(dialog).toHaveCount(0)
}

/** Every note Notepad holds, archived ones too. */
export async function storedNotes(notepad: Page): Promise<StoredNote[]> {
  const result = await invokeChannel<{ data: StoredNote[] }>(
    notepad,
    'terminator.notepad:notes.list',
    { includeArchived: true }
  )
  return result.data
}

/** The stored note with this title, body included. */
export async function storedNote(notepad: Page, title: string): Promise<StoredNote | undefined> {
  const listed = (await storedNotes(notepad)).find((note) => note.title === title)
  if (!listed) return undefined
  const result = await invokeChannel<{ data: StoredNote }>(
    notepad,
    'terminator.notepad:notes.get',
    { id: listed.id }
  )
  return result.data
}

/** A row in the note list, by its exact title. */
export function noteRow(notepad: Page, title: string) {
  return notepad
    .locator('.notepad-note-row')
    .filter({ has: notepad.locator('.notepad-note-row__title').getByText(title, { exact: true }) })
}
