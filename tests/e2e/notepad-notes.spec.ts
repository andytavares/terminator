import { test, expect, type Page } from '@playwright/test'
import { AppHandle, launchApp, closeApp } from './helpers'
import { invokeChannel } from './extension-page'
import { createItem, noteRow, openNotepad, storedNote, storedNotes } from './notepad-harness'

// Notes in Notepad: writing them, tables in them, titles and tags, archiving
// and deleting, ordering, folders, and finding them again by search. Each step
// is read back from what Notepad stored.

let handle: AppHandle
let notepad: Page

test.beforeAll(async () => {
  handle = await launchApp()
  notepad = await openNotepad(handle)
})

test.afterAll(async () => {
  await closeApp(handle)
})

async function typeInEditor(text: string): Promise<void> {
  await notepad.locator('.notepad-view__editor .cm-content').click()
  await notepad.keyboard.press('ControlOrMeta+End')
  await notepad.keyboard.type(text)
}

async function waitForSave(): Promise<void> {
  await expect(notepad.locator('.notepad-view__save-status')).toHaveText('Saved', {
    timeout: 10_000,
  })
}

async function contextMenu(title: string, item: string): Promise<void> {
  await noteRow(notepad, title).click({ button: 'right' })
  await notepad.locator('.notepad-context-menu').getByRole('button', { name: item }).click()
}

test('a note created from New is listed and stored', async () => {
  await createItem(notepad, 'Note', 'Groceries')
  await expect(noteRow(notepad, 'Groceries')).toBeVisible()
  expect(await storedNote(notepad, 'Groceries')).toMatchObject({ title: 'Groceries' })
})

test('typing in a note saves it', async () => {
  await noteRow(notepad, 'Groceries').click()
  // A note's title follows its first heading, so the body opens with one.
  await typeInEditor('# Groceries\nMilk and eggs')
  await waitForSave()
  expect((await storedNote(notepad, 'Groceries'))?.body).toContain('Milk and eggs')
})

test('a markdown table renders as a grid, and editing a cell saves the markdown', async () => {
  await typeInEditor('\n\n| Item | Qty |\n| --- | --- |\n| Bread | 1 |\n\nAfter the table')
  await waitForSave()
  const table = notepad.locator('.notepad-table')
  await expect(table.locator('th')).toHaveText(['Item', 'Qty'])
  await expect(table.locator('td')).toHaveText(['Bread', '1'])

  await table.locator('td', { hasText: '1' }).click()
  // The click puts the caret at the start of the cell's text in the source.
  await notepad.keyboard.press('ArrowRight')
  await notepad.keyboard.type('2')
  await notepad.locator('.notepad-view__editor .cm-content').getByText('After the table').click()
  await waitForSave()
  await expect(notepad.locator('.notepad-table td')).toHaveText(['Bread', '12'])
  expect((await storedNote(notepad, 'Groceries'))?.body).toContain('| Bread | 12 |')
})

test("a note's title and tags are edited from its menu", async () => {
  await contextMenu('Groceries', 'Edit title & tags')
  const dialog = notepad.getByRole('dialog', { name: 'Edit note' })
  await dialog.getByLabel('Title').fill('Weekly groceries')
  await dialog.getByPlaceholder('Add tags…').fill('home')
  await dialog.getByPlaceholder('Add tags…').press('Enter')
  await dialog.getByRole('button', { name: 'Save' }).click()

  await expect(noteRow(notepad, 'Weekly groceries')).toContainText('#home')
  expect(await storedNote(notepad, 'Weekly groceries')).toMatchObject({ tags: ['home'] })
})

test('a note is archived, restored, archived again and deleted for good', async () => {
  await createItem(notepad, 'Note', 'Old draft')
  await contextMenu('Old draft', 'Archive')
  await expect(notepad.getByRole('button', { name: 'Archived (1)' })).toBeVisible()
  expect((await storedNote(notepad, 'Old draft'))?.archivedAt).toBeTruthy()

  await notepad.getByRole('button', { name: 'Archived (1)' }).click()
  await contextMenu('Old draft', 'Unarchive')
  await expect(notepad.getByRole('button', { name: /^Archived/ })).toHaveCount(0)
  expect((await storedNote(notepad, 'Old draft'))?.archivedAt).toBeNull()

  await contextMenu('Old draft', 'Archive')
  // The section stays expanded from before.
  await expect(notepad.getByRole('button', { name: 'Archived (1)' })).toHaveAttribute(
    'aria-expanded',
    'true'
  )
  notepad.once('dialog', (dialog) => void dialog.accept())
  await contextMenu('Old draft', 'Delete')
  await expect(noteRow(notepad, 'Old draft')).toHaveCount(0)
  expect(await storedNote(notepad, 'Old draft')).toBeUndefined()
})

test('dragging a note above another reorders the list', async () => {
  await createItem(notepad, 'Note', 'Reading list')
  const titles = () => notepad.locator('.notepad-note-row__title').allTextContents()
  const before = await titles()
  const [first, second] = [before[0], before[1]]

  // A hand drags in steps, so the row under the pointer sees several dragovers.
  await noteRow(notepad, second).dragTo(noteRow(notepad, first), {
    targetPosition: { x: 10, y: 3 },
    steps: 20,
  })

  await expect.poll(titles).toEqual([second, first, ...before.slice(2)])
  const stored = (await storedNotes(notepad)).filter((note) => !note.archivedAt)
  expect(stored.map((note) => note.title).slice(0, 2)).toEqual([second, first])
})

test('a folder holds notes moved into it, is renamed, and on delete gives them back', async () => {
  await createItem(notepad, 'Folder', 'Household')
  const folder = notepad.locator('.notepad-folder-section', { hasText: 'Household' })
  await expect(folder).toBeVisible()

  await contextMenu('Reading list', 'Move to Household')
  await expect(folder.locator('.notepad-note-row')).toHaveText([/Reading list/])
  const folderId = (await storedNotes(notepad)).find((n) => n.title === 'Reading list')?.folderId
  expect(folderId).toBeTruthy()

  await folder.locator('.notepad-folder-header').click({ button: 'right' })
  await notepad.locator('.notepad-context-menu').getByRole('button', { name: 'Rename' }).click()
  await notepad.locator('.notepad-folder-header__rename-input').fill('Home admin')
  await notepad.locator('.notepad-folder-header__rename-input').press('Enter')
  await expect(notepad.locator('.notepad-folder-header__name')).toHaveText(['Home admin'])

  await notepad.locator('.notepad-folder-header').click({ button: 'right' })
  await notepad
    .locator('.notepad-context-menu')
    .getByRole('button', { name: 'Delete folder' })
    .click()
  await notepad
    .getByRole('dialog', { name: 'Delete folder?' })
    .getByRole('button', { name: 'Delete' })
    .click()
  await expect(notepad.locator('.notepad-folder-section')).toHaveCount(0)
  await expect(noteRow(notepad, 'Reading list')).toBeVisible()
  expect((await storedNotes(notepad)).find((n) => n.title === 'Reading list')?.folderId).toBeNull()
  const folders = await invokeChannel<{ data: unknown[] }>(
    notepad,
    'terminator.notepad:folders.list',
    {}
  )
  expect(folders.data).toEqual([])
})
