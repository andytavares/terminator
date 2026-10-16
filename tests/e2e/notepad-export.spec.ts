import { test, expect } from '@playwright/test'
import { existsSync, mkdtempSync, readFileSync, readdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { AppHandle, launchApp, closeApp, openSettingsSection } from './helpers'
import { answerNextOpenDialog, invokeChannel, type ExtensionView } from './extension-page'
import { noteRow, openNotepad } from './notepad-harness'
import { expectCentredInWindow } from './modal-centre'

// Exporting Notepad to a folder of markdown: notes with front matter, their
// comments in the format chosen, and diagrams as .excalidraw files.

let handle: AppHandle
let notepad: ExtensionView

const RECTANGLE = { id: 'r1', type: 'rectangle', x: 10, y: 20, width: 160, height: 100 }

/** What the export finds: a commented note and a drawn diagram, made in the other specs' way. */
async function seedNoteAndDiagram(notepad: ExtensionView): Promise<void> {
  const note = await invokeChannel<{ data: { id: string } }>(
    notepad,
    'terminator.notepad:notes.create',
    {
      title: 'Trip plan',
      body: '# Trip plan\nBook the ferry.',
      tags: ['travel'],
    }
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
}

test.beforeAll(async () => {
  handle = await launchApp()
  notepad = await openNotepad(handle)
  await seedNoteAndDiagram(notepad)
  await notepad.reload()
  await expect(noteRow(notepad, 'Trip plan')).toBeVisible()
})

test.afterAll(async () => {
  await closeApp(handle)
})

async function exportTo(format: 'Sidecar JSON' | 'Inline HTML' | 'Both'): Promise<string> {
  const folder = mkdtempSync(join(tmpdir(), 'notepad-export-'))
  await notepad.getByRole('button', { name: 'Export', exact: true }).first().click()
  const dialog = notepad.getByRole('dialog', { name: 'Export to markdown' })
  await expectCentredInWindow(dialog, 'Notepad: Export to markdown')
  await answerNextOpenDialog(handle, folder)
  await dialog.getByRole('button', { name: 'Choose folder' }).click()
  await expect(dialog.getByLabel('Destination folder')).toHaveValue(folder)
  await dialog.getByRole('button', { name: format }).click()
  await dialog.getByRole('button', { name: 'Export 1 note' }).click()
  await expect(dialog).toContainText('Last export:')
  await dialog.getByRole('button', { name: 'Cancel' }).click()
  return folder
}

function markdownIn(folder: string): string {
  const file = readdirSync(folder).find((name) => name.endsWith('.md'))!
  return readFileSync(join(folder, file), 'utf8')
}

test('export writes each note with its front matter and its comments beside it', async () => {
  const folder = await exportTo('Sidecar JSON')

  const markdown = markdownIn(folder)
  expect(markdown).toMatch(/^---\n/)
  expect(markdown).toContain('title: Trip plan')
  expect(markdown).toContain('Book the ferry.')
  const sidecar = readdirSync(folder).find((name) => name.endsWith('.comments.json'))!
  expect(JSON.parse(readFileSync(join(folder, sidecar), 'utf8'))).toMatchObject([
    { body: 'Which day?', quote: 'ferry' },
  ])
})

test('export can put the comments inline instead', async () => {
  const folder = await exportTo('Inline HTML')

  expect(markdownIn(folder)).toContain('<!-- comment on "ferry": Which day? -->')
  expect(readdirSync(folder).some((name) => name.endsWith('.comments.json'))).toBe(false)
})

test('export saves each diagram as an .excalidraw file Excalidraw can open', async () => {
  const folder = await exportTo('Both')

  const diagrams = join(folder, 'diagrams')
  expect(existsSync(diagrams)).toBe(true)
  const [file] = readdirSync(diagrams)
  expect(file).toMatch(/^route-map-[0-9a-f]{8}\.excalidraw$/)
  // The .excalidraw format: https://docs.excalidraw.com/docs/codebase/json-schema
  expect(JSON.parse(readFileSync(join(diagrams, file), 'utf8'))).toMatchObject({
    type: 'excalidraw',
    version: 2,
    elements: [RECTANGLE],
  })
})

test('the dialog starts on the folder and comment format chosen in Settings', async () => {
  const folder = mkdtempSync(join(tmpdir(), 'notepad-configured-'))
  const { page } = handle
  await page.bringToFront()
  await openSettingsSection(page, 'Extensions')
  const notepadSettings = page.locator('.extension-item-wrapper').filter({
    has: page.locator('.extension-item__name', { hasText: 'Notepad' }),
  })
  await notepadSettings.getByTitle('Configure').click()
  const exportRow = (label: string) =>
    notepadSettings.locator('.extension-setting-row').filter({ hasText: label })
  await exportRow('Export comments as').getByRole('button', { name: 'Inline' }).click()
  await answerNextOpenDialog(handle, folder)
  await exportRow('Export folder').getByRole('button', { name: 'Choose…' }).click()
  await expect(exportRow('Export folder')).toContainText(folder)
  await page.keyboard.press('Escape')
  await expect(page.locator('.settings-panel')).toBeHidden()

  await notepad.bringToFront()
  await notepad.getByRole('button', { name: 'Export', exact: true }).first().click()
  const dialog = notepad.getByRole('dialog', { name: 'Export to markdown' })
  await expect(dialog.getByLabel('Destination folder')).toHaveValue(folder)
  await expect(dialog.getByRole('button', { name: 'Inline HTML' })).toHaveClass(/--active/)
  await dialog.getByRole('button', { name: 'Export 1 note' }).click()
  await expect(dialog).toContainText('Last export:')

  expect(markdownIn(folder)).toContain('<!-- comment on "ferry": Which day? -->')
})
