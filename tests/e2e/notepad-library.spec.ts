import { test, expect } from '@playwright/test'
import { existsSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { AppHandle, launchApp, closeApp } from './helpers'
import {
  answerNextOpenDialog,
  invokeChannel,
  popoutPage,
  type ExtensionView,
} from './extension-page'
import { openExtensionSettings, settingRow } from './extension-settings-page'
import {
  createItem,
  deleteForGood,
  noteRow,
  openNotepad,
  rowMenu,
  storedNotes,
} from './notepad-harness'
import { expectCentredInWindow } from './modal-centre'

// Notepad's library: a diagram drawn and kept, and notes brought in from a folder, found
// again, and written back out. The flows share one app and run in order: the diagram flow
// deletes what it drew, which leaves the empty notepad the import starts from.

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

// ── A diagram is drawn and kept ─────────────────────────────────────────────

interface StoredDiagram {
  id: string
  title: string
  sceneJson: string
  archivedAt: string | null
}

interface DiagramComment {
  body: string
  status: string
}

let diagramId: string

test('a diagram is drawn, discussed, opened in its own window and retired', async () => {
  await test.step('a diagram created from New opens on its canvas', diagramOpensOnCanvas)
  await test.step('a rectangle drawn on the canvas is saved with the diagram', rectangleIsSaved)
  await test.step('renaming the diagram from its title saves the new name', diagramIsRenamed)
  await test.step('a comment pinned to the canvas is replied to and resolved', () =>
    canvasCommentResolved())
  await test.step('a comment thread on the canvas is deleted', canvasCommentDeleted)
  await test.step('double-clicking the diagram opens it in its own window', diagramPopsOut)
  await test.step('a diagram is archived, restored, archived again and deleted for good', () =>
    diagramRetired())
})

async function diagrams(): Promise<StoredDiagram[]> {
  const result = await invokeChannel<{ data: StoredDiagram[] }>(
    notepad,
    'terminator.notepad:diagrams.list',
    { includeArchived: true }
  )
  return result.data
}

async function storedDiagram(): Promise<StoredDiagram> {
  const result = await invokeChannel<{ data: StoredDiagram }>(
    notepad,
    'terminator.notepad:diagrams.get',
    { id: diagramId }
  )
  return result.data
}

async function sceneElementTypes(): Promise<string[]> {
  const scene = JSON.parse((await storedDiagram()).sceneJson || '{}') as {
    elements?: { type: string; isDeleted?: boolean }[]
  }
  return (scene.elements ?? []).filter((e) => !e.isDeleted).map((e) => e.type)
}

async function diagramComments(): Promise<DiagramComment[]> {
  const result = await invokeChannel<{ data: DiagramComment[] }>(
    notepad,
    'terminator.notepad:diagram-comments.list',
    { diagramId, includeResolved: true }
  )
  return result.data
}

const canvas = () => notepad.locator('.diagram-view__canvas')

async function diagramOpensOnCanvas(): Promise<void> {
  await createItem(notepad, 'Diagram', 'Architecture')
  await expect(notepad.locator('.diagram-view__title-btn')).toContainText('Architecture')
  await expect(canvas().locator('canvas').first()).toBeVisible()
  diagramId = (await diagrams()).find((d) => d.title === 'Architecture')!.id
}

async function rectangleIsSaved(): Promise<void> {
  const box = (await canvas().boundingBox())!
  // Focus the canvas where the toolbar is not: its top bar overlays the corner, so a click at the
  // corner waits for an icon to stop intercepting it, and which icon is under it depends on scroll.
  await canvas()
    .locator('canvas')
    .last()
    .click({ position: { x: box.width / 2, y: Math.min(box.height - 20, 400) } })
  // Pick the tool the way a person does, and wait until it is the one selected. The R shortcut
  // works only once Excalidraw has attached its keyboard handler, which is after its canvas shows.
  const rectangleTool = notepad.getByRole('radio', { name: /rectangle/i })
  await notepad.locator('label', { has: rectangleTool }).click()
  await expect(rectangleTool).toBeChecked()
  await notepad.mouse.move(box.x + box.width / 2 - 80, box.y + box.height / 2 - 50)
  await notepad.mouse.down()
  await notepad.mouse.move(box.x + box.width / 2 + 80, box.y + box.height / 2 + 50, { steps: 8 })
  await notepad.mouse.up()

  await expect.poll(sceneElementTypes).toEqual(['rectangle'])
}

async function diagramIsRenamed(): Promise<void> {
  await notepad.locator('.diagram-view__title-btn').click()
  await notepad.locator('.diagram-view__title-input').fill('System architecture')
  await notepad.locator('.diagram-view__title-input').press('Enter')

  await expect(noteRow(notepad, 'System architecture')).toBeVisible()
  expect((await storedDiagram()).title).toBe('System architecture')
}

/** Pins a comment at (`x`, `y`) on the canvas and opens its thread. */
async function pinComment(body: string, at: { x: number; y: number }): Promise<void> {
  await notepad.getByRole('button', { name: 'Comment' }).click()
  const box = (await canvas().boundingBox())!
  await notepad.mouse.click(box.x + at.x, box.y + at.y)
  await notepad.getByPlaceholder('Add a comment…').fill(body)
  await notepad.getByPlaceholder('Add a comment…').press('ControlOrMeta+Enter')
  await notepad.getByRole('button', { name: `Comment: ${body}` }).click()
}

async function canvasCommentResolved(): Promise<void> {
  await pinComment('Is this the gateway?', { x: 100, y: 120 })
  await notepad.getByPlaceholder('Reply…').fill('Yes, behind the load balancer')
  await notepad.getByPlaceholder('Reply…').press('ControlOrMeta+Enter')
  await expect(notepad.locator('.diagram-comment-popover')).toContainText(
    'Yes, behind the load balancer'
  )

  await notepad.getByRole('button', { name: 'Resolve thread' }).click()
  await expect(notepad.getByRole('button', { name: 'Comment: Is this the gateway?' })).toHaveCount(
    0
  )
  const stored = (await diagramComments()).find((c) => c.body === 'Is this the gateway?')
  expect(stored?.status).toBe('resolved')
}

async function canvasCommentDeleted(): Promise<void> {
  await pinComment('Remove this box?', { x: 160, y: 160 })
  await notepad.getByRole('button', { name: 'Delete thread' }).click()

  await expect(notepad.getByRole('button', { name: 'Comment: Remove this box?' })).toHaveCount(0)
  expect((await diagramComments()).map((c) => c.body)).not.toContain('Remove this box?')
}

async function diagramPopsOut(): Promise<void> {
  await noteRow(notepad, 'System architecture').dblclick()
  const window = await popoutPage(handle, 'view=diagram')
  await expect(window.locator('.diagram-view__title-btn')).toContainText('System architecture')
  await expect(window.locator('.diagram-view__canvas canvas').first()).toBeVisible()
  await window.close()
}

async function diagramRetired(): Promise<void> {
  await rowMenu(notepad, 'System architecture', 'Archive')
  expect((await storedDiagram()).archivedAt).toBeTruthy()
  await notepad.getByRole('button', { name: 'Archived (1)' }).click()

  await rowMenu(notepad, 'System architecture', 'Unarchive')
  await expect(notepad.getByRole('button', { name: /^Archived/ })).toHaveCount(0)
  expect((await storedDiagram()).archivedAt).toBeNull()

  await rowMenu(notepad, 'System architecture', 'Archive')
  await deleteForGood(handle, notepad, 'System architecture')
  expect(await diagrams()).toEqual([])
}

// ── Notes are found and moved in and out ────────────────────────────────────

test('notes are imported, found by text and tag, exported, and survive a database re-initialise', async () => {
  await test.step('a folder of exported markdown imports from the empty notepad', importsFolder)
  await test.step('search finds non-ASCII text whatever its case', searchFindsAnyScript)
  await test.step('the ⌘⇧F overlay searches across notes and filters by tag', () =>
    overlayFiltersByTag())
  await test.step('the remote API lists, renames and deletes tags', remoteApiEditsTags)
  await test.step('a commented note and a drawn diagram are added to export', seedTripPlan)
  await test.step('export writes each note with its front matter and its comments beside it', () =>
    exportWritesSidecar())
  await test.step('export can put the comments inline instead', exportWritesInline)
  await test.step('export saves each diagram as an .excalidraw file Excalidraw can open', () =>
    exportWritesExcalidraw())
  await test.step('the dialog starts on the folder and comment format chosen in Settings', () =>
    exportStartsOnSettings())
  await test.step('Re-initialise database in Settings keeps the notes', reinitialiseKeepsNotes)
})

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

async function importsFolder(): Promise<void> {
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
}

async function searchList(query: string): Promise<string[]> {
  await notepad.getByPlaceholder('Search notes…').fill(query)
  // Results replace the list once the query has answered.
  await expect(
    notepad.locator('.notepad-note-row, .notepad-note-list__no-results').first()
  ).toBeVisible()
  return notepad.locator('.notepad-note-row__title').allTextContents()
}

async function searchFindsAnyScript(): Promise<void> {
  await expect.poll(() => searchList('über')).toEqual(['Über den Wolken'])
  await expect.poll(() => searchList('WÄRE')).toEqual(['Über den Wolken'])
  await expect.poll(() => searchList('crème brûlée')).toEqual(['Café notes'])
  await expect.poll(() => searchList('京都')).toEqual(['日本の旅行'])
  await expect.poll(() => searchList('nothing like this')).toEqual([])
  await expect(notepad.locator('.notepad-note-list__no-results')).toContainText(
    'No results for "nothing like this"'
  )
  await notepad.getByPlaceholder('Search notes…').fill('')
}

async function overlayFiltersByTag(): Promise<void> {
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
}

async function tags(): Promise<{ id: string; name: string; noteCount: number }[]> {
  const result = await invokeChannel<{ data: { id: string; name: string; noteCount: number }[] }>(
    notepad,
    'terminator.notepad:tags.list'
  )
  return result.data
}

async function remoteApiEditsTags(): Promise<void> {
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
}

const RECTANGLE = { id: 'r1', type: 'rectangle', x: 10, y: 20, width: 160, height: 100 }

/** What the export finds besides the imported notes: a commented note and a drawn diagram,
 * made through the bridge because the steps above already drive that by hand. */
async function seedTripPlan(): Promise<void> {
  const note = await invokeChannel<{ data: { id: string } }>(
    notepad,
    'terminator.notepad:notes.create',
    { title: 'Trip plan', body: '# Trip plan\nBook the ferry.', tags: ['travel'] }
  )
  await invokeChannel(notepad, 'terminator.notepad:comments.create', {
    noteId: note.data.id,
    body: 'Which day?',
    startOffset: 17,
    endOffset: 22,
    quote: 'ferry',
  })
  const diagram = await invokeChannel<{ data: { id: string } }>(
    notepad,
    'terminator.notepad:diagrams.create',
    { title: 'Route map' }
  )
  await invokeChannel(notepad, 'terminator.notepad:diagrams.autosave', {
    id: diagram.data.id,
    title: 'Route map',
    sceneJson: JSON.stringify({ elements: [RECTANGLE], appState: {} }),
  })
  await notepad.reload()
  await expect(noteRow(notepad, 'Trip plan')).toBeVisible()
}

const exportDialog = () => notepad.getByRole('dialog', { name: 'Export to markdown' })

/** Exports every note to a fresh folder with comments as `format`, and returns the folder. */
async function exportTo(format: 'Sidecar JSON' | 'Inline HTML' | 'Both'): Promise<string> {
  const folder = mkdtempSync(join(tmpdir(), 'notepad-export-'))
  await notepad.getByRole('button', { name: 'Export', exact: true }).first().click()
  const dialog = exportDialog()
  await expectCentredInWindow(dialog, 'Notepad: Export to markdown')
  await answerNextOpenDialog(handle, folder)
  await dialog.getByRole('button', { name: 'Choose folder' }).click()
  await expect(dialog.getByLabel('Destination folder')).toHaveValue(folder)
  await dialog.getByRole('button', { name: format }).click()
  await dialog.getByRole('button', { name: 'Export 4 notes' }).click()
  await expect(dialog).toContainText('Last export:')
  await dialog.getByRole('button', { name: 'Cancel' }).click()
  return folder
}

/** The exported markdown of the Trip plan note. */
function tripPlanIn(folder: string): string {
  const file = readdirSync(folder).find((name) => /^trip-plan-.*\.md$/.test(name))!
  return readFileSync(join(folder, file), 'utf8')
}

async function exportWritesSidecar(): Promise<void> {
  const folder = await exportTo('Sidecar JSON')

  const markdown = tripPlanIn(folder)
  expect(markdown).toMatch(/^---\n/)
  expect(markdown).toContain('title: Trip plan')
  expect(markdown).toContain('Book the ferry.')
  const sidecar = readdirSync(folder).find((name) => /^trip-plan-.*\.comments\.json$/.test(name))!
  expect(JSON.parse(readFileSync(join(folder, sidecar), 'utf8'))).toMatchObject([
    { body: 'Which day?', quote: 'ferry' },
  ])
}

async function exportWritesInline(): Promise<void> {
  const folder = await exportTo('Inline HTML')

  expect(tripPlanIn(folder)).toContain('<!-- comment on "ferry": Which day? -->')
  expect(readdirSync(folder).some((name) => name.endsWith('.comments.json'))).toBe(false)
}

async function exportWritesExcalidraw(): Promise<void> {
  const folder = await exportTo('Both')

  const diagramsFolder = join(folder, 'diagrams')
  expect(existsSync(diagramsFolder)).toBe(true)
  const [file] = readdirSync(diagramsFolder)
  expect(file).toMatch(/^route-map-[0-9a-f]{8}\.excalidraw$/)
  // The .excalidraw format: https://docs.excalidraw.com/docs/codebase/json-schema
  expect(JSON.parse(readFileSync(join(diagramsFolder, file), 'utf8'))).toMatchObject({
    type: 'excalidraw',
    version: 2,
    elements: [RECTANGLE],
  })
}

/** Sets Notepad's export folder to `folder` and its comment format to Inline in Settings. */
async function configureExportInSettings(folder: string): Promise<void> {
  const { page } = handle
  const entry = await openExtensionSettings(page, 'Notepad')
  await settingRow(entry, 'Export comments as').getByRole('button', { name: 'Inline' }).click()
  await answerNextOpenDialog(handle, folder)
  await settingRow(entry, 'Export folder').getByRole('button', { name: 'Choose…' }).click()
  await expect(settingRow(entry, 'Export folder')).toContainText(folder)
  await page.keyboard.press('Escape')
  await expect(page.locator('.settings-panel')).toBeHidden()
}

async function exportStartsOnSettings(): Promise<void> {
  const folder = mkdtempSync(join(tmpdir(), 'notepad-configured-'))
  await configureExportInSettings(folder)

  await notepad.getByRole('button', { name: 'Export', exact: true }).first().click()
  const dialog = exportDialog()
  await expect(dialog.getByLabel('Destination folder')).toHaveValue(folder)
  await expect(dialog.getByRole('button', { name: 'Inline HTML' })).toHaveClass(/--active/)
  await dialog.getByRole('button', { name: 'Export 4 notes' }).click()
  await expect(dialog).toContainText('Last export:')
  await dialog.getByRole('button', { name: 'Cancel' }).click()

  expect(tripPlanIn(folder)).toContain('<!-- comment on "ferry": Which day? -->')
}

async function reinitialiseKeepsNotes(): Promise<void> {
  const { page } = handle
  const entry = await openExtensionSettings(page, 'Notepad')
  await entry.getByRole('button', { name: 'Re-initialise database', exact: true }).click()

  await expect
    .poll(async () =>
      (await page.evaluate(() => window.electronAPI.notifications.list())).map(
        (notification) => `${notification.title}: ${notification.message}`
      )
    )
    .toContain('Re-initialise database: Done')
  expect(await storedNotes(notepad)).toHaveLength(4)
  await page.keyboard.press('Escape')
}
