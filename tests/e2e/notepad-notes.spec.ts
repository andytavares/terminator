import { test, expect } from '@playwright/test'
import { AppHandle, launchApp, closeApp, closeSettingsPanel } from './helpers'
import { invokeChannel, popoutPage, type ExtensionView } from './extension-page'
import { openExtensionSettings, settingRow } from './extension-settings-page'
import {
  createItem,
  deleteForGood,
  noteRow,
  openNotepad,
  rowMenu,
  storedNote,
  storedNotes,
  typeInEditor,
  waitForSave,
} from './notepad-harness'
import { expectCentredInWindow } from './modal-centre'

// A note's life in Notepad: written and organised, discussed, read through its outline, and
// shaped by its settings. The flows share one app and its note list, so they run in order;
// settings runs last because the debounce it sets would slow every save after it.

let handle: AppHandle
let notepad: ExtensionView

test.describe.configure({ mode: 'serial' })

test.beforeAll(async () => {
  handle = await launchApp()
  notepad = await openNotepad(handle)
})

test.afterAll(async () => {
  await closeApp(handle)
})

test('a note is written, organised and retired', async () => {
  await test.step('a note created from New is listed and stored', createdNoteIsStored)
  await test.step('typing in a note saves it', typingSaves)
  await test.step('a markdown table renders as a grid, and editing a cell saves the markdown', () =>
    tableCellEditSaves())
  await test.step("a note's title and tags are edited from its menu", titleAndTagsFromMenu)
  await test.step('a title set by hand stays when the note is edited again', handSetTitleStays)
  await test.step('a note never renamed by hand keeps following its first heading', () =>
    titleFollowsHeading())
  await test.step('a note is archived, restored, archived again and deleted for good', () =>
    archivedRestoredDeleted())
  await test.step('dragging a note above another reorders the list', dragReorders)
  await test.step('a folder holds notes moved into it, is renamed, and on delete gives them back', () =>
    folderHoldsAndGivesBack())
})

async function createdNoteIsStored(): Promise<void> {
  await createItem(notepad, 'Note', 'Groceries')
  await expect(noteRow(notepad, 'Groceries')).toBeVisible()
  expect(await storedNote(notepad, 'Groceries')).toMatchObject({ title: 'Groceries' })
}

async function typingSaves(): Promise<void> {
  await noteRow(notepad, 'Groceries').click()
  // A note's title follows its first heading, so the body opens with one.
  await typeInEditor(notepad, '# Groceries\nMilk and eggs')
  await waitForSave(notepad)
  expect((await storedNote(notepad, 'Groceries'))?.body).toContain('Milk and eggs')
}

async function tableCellEditSaves(): Promise<void> {
  await typeInEditor(notepad, '\n\n| Item | Qty |\n| --- | --- |\n| Bread | 1 |\n\nAfter the table')
  await waitForSave(notepad)
  const table = notepad.locator('.notepad-table')
  await expect(table.locator('th')).toHaveText(['Item', 'Qty'])
  await expect(table.locator('td')).toHaveText(['Bread', '1'])

  await table.locator('td', { hasText: '1' }).click()
  // The click puts the caret at the start of the cell's text in the source.
  await notepad.keyboard.press('ArrowRight')
  await notepad.keyboard.type('2')
  await notepad.locator('.notepad-view__editor .cm-content').getByText('After the table').click()
  await waitForSave(notepad)
  await expect(notepad.locator('.notepad-table td')).toHaveText(['Bread', '12'])
  expect((await storedNote(notepad, 'Groceries'))?.body).toContain('| Bread | 12 |')
}

async function titleAndTagsFromMenu(): Promise<void> {
  await rowMenu(notepad, 'Groceries', 'Edit title & tags')
  const dialog = notepad.getByRole('dialog', { name: 'Edit note' })
  await expectCentredInWindow(dialog, 'Notepad: Edit note')
  await dialog.getByLabel('Title').fill('Weekly groceries')
  await dialog.getByPlaceholder('Add tags…').fill('home')
  await dialog.getByPlaceholder('Add tags…').press('Enter')
  await dialog.getByRole('button', { name: 'Save' }).click()

  await expect(noteRow(notepad, 'Weekly groceries')).toContainText('#home')
  expect(await storedNote(notepad, 'Weekly groceries')).toMatchObject({ tags: ['home'] })
}

async function handSetTitleStays(): Promise<void> {
  // The body still opens with "# Groceries", which is what the title followed.
  await noteRow(notepad, 'Weekly groceries').click()
  await typeInEditor(notepad, '\nAnd bread')
  await waitForSave(notepad)

  await expect(noteRow(notepad, 'Weekly groceries')).toBeVisible()
  expect((await storedNote(notepad, 'Weekly groceries'))?.body).toContain('And bread')
}

async function titleFollowsHeading(): Promise<void> {
  await createItem(notepad, 'Note', 'Scratch')
  await noteRow(notepad, 'Scratch').click()
  await typeInEditor(notepad, '# Packing list\nSocks')
  await waitForSave(notepad)

  await expect(noteRow(notepad, 'Packing list')).toBeVisible()
  expect(await storedNote(notepad, 'Packing list')).toBeTruthy()
}

async function archivedRestoredDeleted(): Promise<void> {
  await createItem(notepad, 'Note', 'Old draft')
  await rowMenu(notepad, 'Old draft', 'Archive')
  await expect(notepad.getByRole('button', { name: 'Archived (1)' })).toBeVisible()
  expect((await storedNote(notepad, 'Old draft'))?.archivedAt).toBeTruthy()

  await notepad.getByRole('button', { name: 'Archived (1)' }).click()
  await rowMenu(notepad, 'Old draft', 'Unarchive')
  await expect(notepad.getByRole('button', { name: /^Archived/ })).toHaveCount(0)
  expect((await storedNote(notepad, 'Old draft'))?.archivedAt).toBeNull()

  await rowMenu(notepad, 'Old draft', 'Archive')
  // The section stays expanded from before.
  await expect(notepad.getByRole('button', { name: 'Archived (1)' })).toHaveAttribute(
    'aria-expanded',
    'true'
  )
  await deleteForGood(handle, notepad, 'Old draft')
  expect(await storedNote(notepad, 'Old draft')).toBeUndefined()
}

async function dragReorders(): Promise<void> {
  await createItem(notepad, 'Note', 'Reading list')
  const noteTitles = () => notepad.locator('.notepad-note-row__title').allTextContents()
  const before = await noteTitles()
  const [first, second] = [before[0], before[1]]

  // A hand drags in steps, so the row under the pointer sees several dragovers.
  await noteRow(notepad, second).dragTo(noteRow(notepad, first), {
    targetPosition: { x: 10, y: 3 },
    steps: 20,
  })

  await expect.poll(noteTitles).toEqual([second, first, ...before.slice(2)])
  const stored = (await storedNotes(notepad)).filter((note) => !note.archivedAt)
  expect(stored.map((note) => note.title).slice(0, 2)).toEqual([second, first])
}

async function folderOfReadingList(): Promise<string | null | undefined> {
  return (await storedNotes(notepad)).find((note) => note.title === 'Reading list')?.folderId
}

/** Picks `item` from the one folder's context menu. */
async function folderMenu(item: string): Promise<void> {
  await notepad.locator('.notepad-folder-header').click({ button: 'right' })
  await notepad.locator('.notepad-context-menu').getByRole('button', { name: item }).click()
}

async function folderHoldsAndGivesBack(): Promise<void> {
  await createItem(notepad, 'Folder', 'Household')
  const folder = notepad.locator('.notepad-folder-section', { hasText: 'Household' })
  await expect(folder).toBeVisible()
  await rowMenu(notepad, 'Reading list', 'Move to Household')
  await expect(folder.locator('.notepad-note-row')).toHaveText([/Reading list/])
  expect(await folderOfReadingList()).toBeTruthy()

  await folderMenu('Rename')
  await notepad.locator('.notepad-folder-header__rename-input').fill('Home admin')
  await notepad.locator('.notepad-folder-header__rename-input').press('Enter')
  await expect(notepad.locator('.notepad-folder-header__name')).toHaveText(['Home admin'])

  await folderMenu('Delete folder')
  await notepad
    .getByRole('dialog', { name: 'Delete folder?' })
    .getByRole('button', { name: 'Delete' })
    .click()
  await expect(notepad.locator('.notepad-folder-section')).toHaveCount(0)
  await expect(noteRow(notepad, 'Reading list')).toBeVisible()
  expect(await folderOfReadingList()).toBeNull()
  const folders = await invokeChannel<{ data: unknown[] }>(
    notepad,
    'terminator.notepad:folders.list',
    {}
  )
  expect(folders.data).toEqual([])
}

// ── A note is discussed ─────────────────────────────────────────────────────

interface StoredComment {
  id: string
  body: string
  status: string
  quote: string | null
  startOffset: number | null
  replies: { body: string }[]
}

const REVIEW_BODY = '# Review\nThe quick brown fox jumps over the lazy dog.'
let reviewId: string

test('a note is discussed in comments anchored to its text', async () => {
  await test.step('a note to discuss is written', writeReviewNote)
  await test.step('a comment is anchored to the text selected', commentIsAnchored)
  await test.step('a comment is edited, replied to and resolved', commentEditedRepliedResolved)
  await test.step('an anchor follows its text when the note is edited above it', () =>
    anchorFollowsEdits())
  await test.step('deleting the anchored text orphans the comment, which can then be deleted', () =>
    orphanedCommentIsDeleted())
})

async function writeReviewNote(): Promise<void> {
  await createItem(notepad, 'Note', 'Review')
  await noteRow(notepad, 'Review').click()
  await typeInEditor(notepad, REVIEW_BODY)
  await waitForSave(notepad)
  reviewId = (await storedNote(notepad, 'Review'))!.id
}

async function storedComments(): Promise<StoredComment[]> {
  const result = await invokeChannel<{ data: StoredComment[] }>(
    notepad,
    'terminator.notepad:comments.list',
    { noteId: reviewId, includeResolved: true }
  )
  return result.data.filter((comment) => comment.quote !== null)
}

/** Selects `length` characters from `start` with the keyboard, from the top of the note. */
async function selectRange(start: number, length: number): Promise<void> {
  await notepad.locator('.notepad-view__editor .cm-content').click()
  await notepad.keyboard.press('ControlOrMeta+Home')
  // Line 1 is the heading; the caret moves by characters across the newline.
  for (let i = 0; i < start; i++) await notepad.keyboard.press('ArrowRight')
  for (let i = 0; i < length; i++) await notepad.keyboard.press('Shift+ArrowRight')
}

function commentCard(body: string) {
  return notepad.locator('.notepad-comment').filter({ hasText: body })
}

/** Comments on `text` as first written, through the selection's Add comment button. */
async function commentOn(text: string, body: string): Promise<void> {
  await selectRange(REVIEW_BODY.indexOf(text), text.length)
  await notepad.getByTitle('Add comment').dispatchEvent('mousedown')
  await notepad.getByPlaceholder('Add a comment…').fill(body)
  await notepad.getByRole('button', { name: 'Add comment' }).click()
  await expect(commentCard(body)).toBeVisible()
}

async function commentIsAnchored(): Promise<void> {
  await commentOn('brown fox', 'Which fox?')
  await expect(commentCard('Which fox?')).toContainText('“brown fox”')
  expect(await storedComments()).toMatchObject([
    {
      body: 'Which fox?',
      quote: 'brown fox',
      status: 'open',
      startOffset: REVIEW_BODY.indexOf('brown fox'),
    },
  ])
}

async function commentEditedRepliedResolved(): Promise<void> {
  await commentCard('Which fox?')
    .getByRole('button', { name: 'Edit comment (click to edit)' })
    .click()
  await commentCard('Which fox?')
    .getByLabel('Edit comment', { exact: true })
    .fill('Which fox, exactly?')
  await commentCard('Which fox').getByRole('button', { name: 'Save' }).click()
  const edited = commentCard('Which fox, exactly?')
  await expect(edited).toBeVisible()

  await edited.getByRole('button', { name: 'Reply' }).click()
  await edited.getByPlaceholder('Write a reply…').fill('The red one')
  await edited.getByRole('button', { name: 'Send' }).click()
  await expect(edited).toContainText('The red one')

  await edited.getByRole('button', { name: 'Resolve' }).click()
  await expect
    .poll(async () => (await storedComments())[0])
    .toMatchObject({
      body: 'Which fox, exactly?',
      status: 'resolved',
      replies: [{ body: 'The red one' }],
    })
}

async function anchorFollowsEdits(): Promise<void> {
  await commentOn('jumps over', 'Over what?')
  await notepad.locator('.notepad-view__editor .cm-content').click()
  await notepad.keyboard.press('ControlOrMeta+Home')
  await notepad.keyboard.press('ArrowDown')
  await notepad.keyboard.press('Home')
  await notepad.keyboard.type('Note: ')

  await expect
    .poll(async () => (await storedComments()).find((c) => c.body === 'Over what?')?.startOffset)
    .toBe(REVIEW_BODY.indexOf('jumps over') + 'Note: '.length)
}

async function orphanedCommentIsDeleted(): Promise<void> {
  await commentOn('lazy dog', 'Too lazy?')
  // The anchored words are now six characters further on, after "Note: ".
  await selectRange(REVIEW_BODY.indexOf('lazy dog') + 'Note: '.length, 'lazy dog'.length)
  await notepad.keyboard.press('Backspace')

  await expect
    .poll(async () => (await storedComments()).find((c) => c.body === 'Too lazy?')?.status)
    .toBe('orphaned')
  await expect(commentCard('Too lazy?')).toHaveClass(/notepad-comment--orphaned/)

  await commentCard('Too lazy?').getByRole('button', { name: 'Delete comment' }).click()
  await expect(commentCard('Too lazy?')).toHaveCount(0)
  expect((await storedComments()).map((c) => c.body)).toEqual(['Which fox, exactly?', 'Over what?'])
}

// ── A long note is read through its outline ─────────────────────────────────

// Long enough that the editor genuinely has to scroll: a note that fits on
// screen cannot tell a working jump from a no-op.
const FILLER = Array.from({ length: 40 }, (_, i) => `Body line ${i}.`).join('\n')
const OUTLINE_BODY = [
  '# Alpha',
  FILLER,
  '## Beta',
  FILLER,
  '```md',
  '# Fenced, not a heading',
  '```',
  '## Omega',
  FILLER,
].join('\n')

test("a long note is read through its outline, in the panel and in the note's own window", async () => {
  await test.step('a long note with headings is opened', openOutlineNote)
  await test.step('the rail lists the open note headings, nested by level', outlineIsNested)
  await test.step('clicking a heading scrolls the editor to it', headingClickScrolls)
  await test.step('the rail splits evenly between the outline and the comments', railSplitsEvenly)
  await test.step('one panel takes the whole rail when the other is closed', () =>
    onePanelFillsRail())
  await test.step('the outline closes from the panel and comes back from the toolbar', () =>
    outlineClosesAndReturns())
  await test.step('closing both rail panels gives the width back to the editor', () =>
    editorTakesRailWidth())
  await test.step('a popped-out note window gets the same outline', popOutHasOutline)
})

const outlineItems = () => notepad.locator('.notepad-outline__item')
const toolbarToggle = (name: 'Outline' | 'Comments') =>
  notepad.locator('.notepad-view__toolbar').getByRole('button', { name, exact: true })
const heightOf = async (selector: string) =>
  (await notepad.locator(selector).boundingBox())?.height ?? 0

/** Seeded through the extension's own bridge: typing 130 lines of markdown
 * would exercise the input plumbing, not the outline. */
async function openOutlineNote(): Promise<void> {
  await invokeChannel(notepad, 'terminator.notepad:notes.create', {
    title: 'Outline fixture',
    body: OUTLINE_BODY,
  })
  await notepad.reload()
  await noteRow(notepad, 'Outline fixture').click()
  await expect(outlineItems()).toHaveText(['Alpha', 'Beta', 'Omega'])
}

async function outlineIsNested(): Promise<void> {
  const depths = await outlineItems().evaluateAll((items) =>
    items.map((item) => (item as HTMLElement).style.getPropertyValue('--outline-depth'))
  )
  expect(depths).toEqual(['0', '1', '1'])
}

async function headingClickScrolls(): Promise<void> {
  const scroller = notepad.locator('.notepad-view__editor .cm-scroller')
  const scrollTop = () => scroller.evaluate((element) => element.scrollTop)
  expect(await scrollTop()).toBe(0)
  await outlineItems().filter({ hasText: 'Omega' }).click()
  await expect.poll(scrollTop).toBeGreaterThan(500)
  // Back to the top of the document, not merely somewhere above Omega.
  await outlineItems().filter({ hasText: 'Alpha' }).click()
  await expect.poll(scrollTop).toBeLessThan(100)
}

async function railSplitsEvenly(): Promise<void> {
  // The outline sized itself to its headings, so a long note pushed the
  // comments into a sliver. Neither panel gets to grow at the other's expense.
  const outline = await heightOf('.notepad-outline')
  const comments = await heightOf('.notepad-view__comments')
  expect(Math.abs(outline - comments)).toBeLessThan(2)
  expect(outline + comments).toBeCloseTo(await heightOf('.notepad-view__rail'), 0)
}

async function onePanelFillsRail(): Promise<void> {
  const commentsShortfall = async () =>
    (await heightOf('.notepad-view__rail')) - (await heightOf('.notepad-view__comments'))
  await toolbarToggle('Outline').click()
  await expect(outlineItems()).toHaveCount(0)
  await expect.poll(commentsShortfall).toBeLessThan(1)
  await toolbarToggle('Outline').click()
  await expect(outlineItems()).toHaveCount(3)
}

async function outlineClosesAndReturns(): Promise<void> {
  await notepad.getByRole('button', { name: 'Close outline' }).click()
  await expect(outlineItems()).toHaveCount(0)
  await toolbarToggle('Outline').click()
  await expect(outlineItems()).toHaveCount(3)
}

async function editorTakesRailWidth(): Promise<void> {
  const editorWidth = async () =>
    (await notepad.locator('.notepad-view__editor').boundingBox())?.width ?? 0
  const withRail = await editorWidth()
  await toolbarToggle('Outline').click()
  await toolbarToggle('Comments').click()
  await expect.poll(editorWidth).toBeGreaterThan(withRail + 200)
  await toolbarToggle('Outline').click()
  await toolbarToggle('Comments').click()
  await expect(outlineItems()).toHaveCount(3)
}

async function popOutHasOutline(): Promise<void> {
  await noteRow(notepad, 'Outline fixture').dblclick()
  // The window loads its own copy of the renderer and fetches the note over the bridge.
  const window = await popoutPage(handle, 'view=note')
  await expect(window.locator('.notepad-outline__item')).toHaveText(['Alpha', 'Beta', 'Omega'])
  await window.close()
}

// ── Notepad's settings change the editor ────────────────────────────────────

test("Notepad's settings change the editor's text size and how long it waits to save", async () => {
  await test.step('a note to write in is opened', async () => {
    await createItem(notepad, 'Note', 'Settings')
    await noteRow(notepad, 'Settings').click()
  })
  await test.step('"Editor font size" sets the size of the text in the editor', fontSizeApplies)
  await test.step('"Autosave debounce" is how long typing must pause before the note is saved', () =>
    debounceDelaysSave())
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
    .evaluate((element) => getComputedStyle(element).fontSize)

async function fontSizeApplies(): Promise<void> {
  expect(await fontSize()).toBe('14px')
  await changeNotepadSetting('Editor font size', '18')
  await expect.poll(fontSize).toBe('18px')
}

async function debounceDelaysSave(): Promise<void> {
  await changeNotepadSetting('Autosave debounce', '3000')
  await notepad.keyboard.press('ControlOrMeta+End')
  // A note's title follows its first heading, so the body opens with one.
  await notepad.keyboard.type('# Settings\nwaited')
  const typedAt = Date.now()

  await waitForSave(notepad)
  // The default of 800 ms would have saved within about a second.
  expect(Date.now() - typedAt).toBeGreaterThanOrEqual(2500)
  expect((await storedNote(notepad, 'Settings'))?.body).toContain('waited')
}
