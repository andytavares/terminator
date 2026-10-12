import { test, expect, type Page } from '@playwright/test'
import { AppHandle, launchApp, closeApp } from './helpers'
import { invokeChannel } from './extension-page'
import { createItem, noteRow, openNotepad, storedNote } from './notepad-harness'

// Comments on a note: anchoring one to selected text, editing, replying,
// resolving and deleting it, and how an anchor follows its text as the note is
// edited, or is orphaned when its text is deleted.

interface StoredComment {
  id: string
  body: string
  status: string
  quote: string | null
  startOffset: number | null
  replies: { body: string }[]
}

let handle: AppHandle
let notepad: Page
let noteId: string

const BODY = '# Review\nThe quick brown fox jumps over the lazy dog.'

test.beforeAll(async () => {
  handle = await launchApp()
  notepad = await openNotepad(handle)
  await createItem(notepad, 'Note', 'Review')
  await noteRow(notepad, 'Review').click()
  await notepad.locator('.notepad-view__editor .cm-content').click()
  await notepad.keyboard.type(BODY)
  await expect(notepad.locator('.notepad-view__save-status')).toHaveText('Saved', {
    timeout: 10_000,
  })
  noteId = (await storedNote(notepad, 'Review'))!.id
})

test.afterAll(async () => {
  await closeApp(handle)
})

async function comments(): Promise<StoredComment[]> {
  const result = await invokeChannel<{ data: StoredComment[] }>(
    notepad,
    'terminator.notepad:comments.list',
    { noteId, includeResolved: true }
  )
  return result.data.filter((comment) => comment.quote !== null)
}

/** Selects `text` in the editor with the keyboard, from the start of the document. */
async function selectInEditor(text: string): Promise<void> {
  const start = BODY.indexOf(text)
  await notepad.locator('.notepad-view__editor .cm-content').click()
  await notepad.keyboard.press('ControlOrMeta+Home')
  // Line 1 is the heading; the caret moves by characters across the newline.
  for (let i = 0; i < start; i++) await notepad.keyboard.press('ArrowRight')
  for (let i = 0; i < text.length; i++) await notepad.keyboard.press('Shift+ArrowRight')
}

function card(body: string) {
  return notepad.locator('.notepad-comment').filter({ hasText: body })
}

test('a comment is anchored to the text selected', async () => {
  await selectInEditor('brown fox')
  await notepad.getByTitle('Add comment').dispatchEvent('mousedown')
  await notepad.getByPlaceholder('Add a comment…').fill('Which fox?')
  await notepad.getByRole('button', { name: 'Add comment' }).click()

  await expect(card('Which fox?')).toContainText('“brown fox”')
  expect(await comments()).toMatchObject([
    {
      body: 'Which fox?',
      quote: 'brown fox',
      status: 'open',
      startOffset: BODY.indexOf('brown fox'),
    },
  ])
})

test('a comment is edited, replied to and resolved', async () => {
  await card('Which fox?').getByRole('button', { name: 'Edit comment (click to edit)' }).click()
  await card('Which fox?').getByLabel('Edit comment', { exact: true }).fill('Which fox, exactly?')
  await card('Which fox').getByRole('button', { name: 'Save' }).click()
  await expect(card('Which fox, exactly?')).toBeVisible()

  await card('Which fox, exactly?').getByRole('button', { name: 'Reply' }).click()
  await card('Which fox, exactly?').getByPlaceholder('Write a reply…').fill('The red one')
  await card('Which fox, exactly?').getByRole('button', { name: 'Send' }).click()
  await expect(card('Which fox, exactly?')).toContainText('The red one')

  await card('Which fox, exactly?').getByRole('button', { name: 'Resolve' }).click()
  await expect
    .poll(async () => (await comments())[0])
    .toMatchObject({
      body: 'Which fox, exactly?',
      status: 'resolved',
      replies: [{ body: 'The red one' }],
    })
})

test('an anchor follows its text when the note is edited above it', async () => {
  await selectInEditor('jumps over')
  await notepad.getByTitle('Add comment').dispatchEvent('mousedown')
  await notepad.getByPlaceholder('Add a comment…').fill('Over what?')
  await notepad.getByRole('button', { name: 'Add comment' }).click()
  await expect(card('Over what?')).toBeVisible()

  await notepad.locator('.notepad-view__editor .cm-content').click()
  await notepad.keyboard.press('ControlOrMeta+Home')
  await notepad.keyboard.press('ArrowDown')
  await notepad.keyboard.press('Home')
  await notepad.keyboard.type('Note: ')

  await expect
    .poll(async () => (await comments()).find((c) => c.body === 'Over what?')?.startOffset, {
      timeout: 10_000,
    })
    .toBe(BODY.indexOf('jumps over') + 'Note: '.length)
})

test('deleting the anchored text orphans the comment, which can then be deleted', async () => {
  await selectInEditor('lazy dog')
  await notepad.getByTitle('Add comment').dispatchEvent('mousedown')
  await notepad.getByPlaceholder('Add a comment…').fill('Too lazy?')
  await notepad.getByRole('button', { name: 'Add comment' }).click()
  await expect(card('Too lazy?')).toBeVisible()

  // Select the anchored words again, now six characters further on, and delete them.
  const start = BODY.indexOf('lazy dog') + 'Note: '.length
  await notepad.locator('.notepad-view__editor .cm-content').click()
  await notepad.keyboard.press('ControlOrMeta+Home')
  for (let i = 0; i < start; i++) await notepad.keyboard.press('ArrowRight')
  for (let i = 0; i < 'lazy dog'.length; i++) await notepad.keyboard.press('Shift+ArrowRight')
  await notepad.keyboard.press('Backspace')

  await expect
    .poll(async () => (await comments()).find((c) => c.body === 'Too lazy?')?.status, {
      timeout: 10_000,
    })
    .toBe('orphaned')
  await expect(card('Too lazy?')).toHaveClass(/notepad-comment--orphaned/)

  await card('Too lazy?').getByRole('button', { name: 'Delete comment' }).click()
  await expect(card('Too lazy?')).toHaveCount(0)
  expect((await comments()).map((c) => c.body)).toEqual(['Which fox, exactly?', 'Over what?'])
})
