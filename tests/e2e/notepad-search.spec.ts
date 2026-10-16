import { test, expect } from '@playwright/test'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { AppHandle, launchApp, closeApp, openSettingsSection } from './helpers'
import { answerNextOpenDialog, invokeChannel, type ExtensionView } from './extension-page'
import { noteRow, openNotepad, storedNotes } from './notepad-harness'
import { expectCentredInWindow } from './modal-centre'

// Bringing notes in from a folder of markdown, and finding them again: the
// list's search box and the ⌘⇧F overlay, with text in any script, and tags.

let handle: AppHandle
let notepad: ExtensionView

/** Markdown files as an export from another machine left them: front matter, then the body. */
function exportedFolder(): string {
  const folder = mkdtempSync(join(tmpdir(), 'notepad-import-'))
  const files: [string, string, string, string[]][] = [
    ['a1', 'Über den Wolken', 'Die Freiheit wäre grenzenlos.', ['reise']],
    ['a2', '日本の旅行', '東京と京都を訪ねる。', ['reise']],
    ['a3', 'Café notes', 'Order a CRÈME BRÛLÉE next time.', ['food']],
  ]
  for (const [id, title, body, tags] of files) {
    const frontMatter = `---\nid: ${id}\ntitle: ${title}\ntags: [${tags.join(', ')}]\n---\n`
    writeFileSync(join(folder, `${id}.md`), `${frontMatter}${body}\n`)
  }
  writeFileSync(join(folder, 'no-front-matter.md'), 'Not a Notepad export\n')
  return folder
}

test.beforeAll(async () => {
  handle = await launchApp()
  notepad = await openNotepad(handle)
})

test.afterAll(async () => {
  await closeApp(handle)
})

async function searchList(query: string): Promise<string[]> {
  await notepad.getByPlaceholder('Search notes…').fill(query)
  // Results replace the list once the query has answered.
  await expect(
    notepad.locator('.notepad-note-row, .notepad-note-list__no-results').first()
  ).toBeVisible()
  return notepad.locator('.notepad-note-row__title').allTextContents()
}

test('a folder of exported markdown imports from the empty notepad', async () => {
  await answerNextOpenDialog(handle, exportedFolder())
  await notepad.getByRole('button', { name: 'Import a folder…' }).click()

  await expect(noteRow(notepad, 'Über den Wolken')).toBeVisible()
  await expect(noteRow(notepad, '日本の旅行')).toBeVisible()
  await expect(noteRow(notepad, 'Café notes')).toBeVisible()
  const stored = await storedNotes(notepad)
  expect(stored.map((note) => note.title).sort()).toEqual([
    'Café notes',
    'Über den Wolken',
    '日本の旅行',
  ])
  expect(stored.find((note) => note.id === 'a2')?.tags).toEqual(['reise'])
})

test('search finds non-ASCII text whatever its case', async () => {
  await expect.poll(() => searchList('über')).toEqual(['Über den Wolken'])
  await expect.poll(() => searchList('WÄRE')).toEqual(['Über den Wolken'])
  await expect.poll(() => searchList('crème brûlée')).toEqual(['Café notes'])
  await expect.poll(() => searchList('京都')).toEqual(['日本の旅行'])
  await expect.poll(() => searchList('nothing like this')).toEqual([])
  await expect(notepad.locator('.notepad-note-list__no-results')).toContainText(
    'No results for "nothing like this"'
  )
  await notepad.getByPlaceholder('Search notes…').fill('')
})

test('the ⌘⇧F overlay searches across notes and filters by tag', async () => {
  await notepad.locator('.notepad-note-list').click()
  await notepad.keyboard.press('ControlOrMeta+Shift+F')
  const overlay = notepad.locator('.notepad-search-overlay')
  await expect(overlay).toBeVisible()
  await expectCentredInWindow(overlay, 'Notepad: Search notes')

  await overlay.getByPlaceholder('Search across all notes').fill('tag:reise')
  await expect(overlay).toContainText('Über den Wolken')
  await expect(overlay).toContainText('日本の旅行')
  await expect(overlay).not.toContainText('Café notes')
  await overlay.getByPlaceholder('Search across all notes').fill('tag:reise wolken')
  await expect(overlay).not.toContainText('日本の旅行')
  await notepad.keyboard.press('Escape')
  await expect(overlay).toHaveCount(0)
})

test('the remote API lists, renames and deletes tags', async () => {
  const tags = async () =>
    (
      await invokeChannel<{ data: { id: string; name: string; noteCount: number }[] }>(
        notepad,
        'terminator.notepad:tags.list'
      )
    ).data
  expect((await tags()).map((tag) => [tag.name, tag.noteCount])).toEqual([
    ['food', 1],
    ['reise', 2],
  ])

  const reise = (await tags()).find((tag) => tag.name === 'reise')!
  await invokeChannel(notepad, 'terminator.notepad:tags.rename', { id: reise.id, name: 'travel' })
  const food = (await tags()).find((tag) => tag.name === 'food')!
  await invokeChannel(notepad, 'terminator.notepad:tags.delete', { id: food.id })

  expect((await tags()).map((tag) => tag.name)).toEqual(['travel'])
  await notepad.reload()
  await expect(noteRow(notepad, '日本の旅行')).toContainText('#travel')
  await expect(noteRow(notepad, 'Café notes')).not.toContainText('#')
})

test('Re-initialise database in Settings keeps the notes', async () => {
  const { page } = handle
  await page.bringToFront()
  await openSettingsSection(page, 'Extensions')
  const row = page.locator('.extension-item-wrapper').filter({
    has: page.locator('.extension-item__name', { hasText: 'Notepad' }),
  })
  await row.getByTitle('Configure').click()
  await row.getByRole('button', { name: 'Re-initialise database', exact: true }).click()

  await expect
    .poll(async () =>
      (await page.evaluate(() => window.electronAPI.notifications.list())).map(
        (notification) => `${notification.title}: ${notification.message}`
      )
    )
    .toContain('Re-initialise database: Done')
  expect(await storedNotes(notepad)).toHaveLength(3)
  await page.keyboard.press('Escape')
})
