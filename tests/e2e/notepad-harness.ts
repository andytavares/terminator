import { expect } from '@playwright/test'
import { acceptingDialog, type AppHandle } from './helpers'
import { invokeChannel, openFromAppBand, type ExtensionView } from './extension-page'
import { expectCentredInWindow } from './modal-centre'

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
export async function openNotepad(handle: AppHandle): Promise<ExtensionView> {
  const notepad = await openFromAppBand(handle, 'Notes', NOTEPAD_URL)
  await expect(notepad.locator('.notepad-view')).toBeVisible()
  return notepad
}

/** Creates a note, diagram or folder through the New dialog, as a user does. */
export async function createItem(
  notepad: ExtensionView,
  kind: 'Note' | 'Diagram' | 'Folder',
  title: string
): Promise<void> {
  const newButton = notepad.getByRole('button', { name: /^New/ }).first()
  await newButton.click()
  const dialog = notepad.locator('.notepad-quick-create')
  await expectCentredInWindow(dialog, 'Notepad: New item')
  await dialog.getByRole('radio', { name: kind }).click()
  await dialog.getByPlaceholder('Title').fill(title)
  await dialog.getByRole('button', { name: /^Save/ }).click()
  await expect(dialog).toHaveCount(0)
}

/** Every note Notepad holds, archived ones too. */
export async function storedNotes(notepad: ExtensionView): Promise<StoredNote[]> {
  const result = await invokeChannel<{ data: StoredNote[] }>(
    notepad,
    'terminator.notepad:notes.list',
    { includeArchived: true }
  )
  return result.data
}

/** The stored note with this title, body included. */
export async function storedNote(
  notepad: ExtensionView,
  title: string
): Promise<StoredNote | undefined> {
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
export function noteRow(notepad: ExtensionView, title: string) {
  return notepad
    .locator('.notepad-note-row')
    .filter({ has: notepad.locator('.notepad-note-row__title').getByText(title, { exact: true }) })
}

/** Types `text` at the end of the open note, as a user does. */
export async function typeInEditor(notepad: ExtensionView, text: string): Promise<void> {
  await notepad.locator('.notepad-view__editor .cm-content').click()
  await notepad.keyboard.press('ControlOrMeta+End')
  await notepad.keyboard.type(text)
}

/** Waits for the open note to report that what was typed is saved. */
export async function waitForSave(notepad: ExtensionView): Promise<void> {
  await expect(notepad.locator('.notepad-view__save-status')).toHaveText('Saved')
}

/** Picks `item` from the context menu of the list row titled `title`. */
export async function rowMenu(notepad: ExtensionView, title: string, item: string): Promise<void> {
  await noteRow(notepad, title).click({ button: 'right' })
  await notepad.locator('.notepad-context-menu').getByRole('button', { name: item }).click()
}

/** Deletes the row titled `title` for good from its menu, accepting the host page's confirm. */
export async function deleteForGood(
  handle: AppHandle,
  notepad: ExtensionView,
  title: string
): Promise<void> {
  // The confirm dialog is the host page's, not the frame's, so it is answered there.
  await acceptingDialog(handle.page, () => rowMenu(notepad, title, 'Delete'))
  await expect(noteRow(notepad, title)).toHaveCount(0)
}
