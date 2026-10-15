import { test, expect } from '@playwright/test'
import { AppHandle, launchApp, closeApp } from './helpers'
import { popoutPage, invokeChannel, type ExtensionView } from './extension-page'
import { createItem, noteRow, openNotepad } from './notepad-harness'

// Diagrams in Notepad: drawing on the Excalidraw canvas, renaming, pinning
// comments to the canvas, opening a diagram in its own window, and archiving,
// restoring and deleting it. Each step is read back from what Notepad stored.

interface StoredDiagram {
  id: string
  title: string
  sceneJson: string
  archivedAt: string | null
}

interface DiagramComment {
  body: string
  status: string
  replies?: { body: string }[]
}

let handle: AppHandle
let notepad: ExtensionView
let diagramId: string

test.beforeAll(async () => {
  handle = await launchApp()
  notepad = await openNotepad(handle)
})

test.afterAll(async () => {
  await closeApp(handle)
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

test('a diagram created from New opens on its canvas', async () => {
  await createItem(notepad, 'Diagram', 'Architecture')
  await expect(notepad.locator('.diagram-view__title-btn')).toContainText('Architecture')
  await expect(canvas().locator('canvas').first()).toBeVisible({ timeout: 20_000 })
  diagramId = (await diagrams()).find((d) => d.title === 'Architecture')!.id
})

test('a rectangle drawn on the canvas is saved with the diagram', async () => {
  const box = (await canvas().boundingBox())!
  await canvas()
    .locator('canvas')
    .last()
    .click({ position: { x: 20, y: 20 } })
  await notepad.keyboard.press('r')
  await notepad.mouse.move(box.x + box.width / 2 - 80, box.y + box.height / 2 - 50)
  await notepad.mouse.down()
  await notepad.mouse.move(box.x + box.width / 2 + 80, box.y + box.height / 2 + 50, { steps: 8 })
  await notepad.mouse.up()

  await expect.poll(sceneElementTypes, { timeout: 10_000 }).toEqual(['rectangle'])
})

test('renaming the diagram from its title saves the new name', async () => {
  await notepad.locator('.diagram-view__title-btn').click()
  await notepad.locator('.diagram-view__title-input').fill('System architecture')
  await notepad.locator('.diagram-view__title-input').press('Enter')

  await expect(noteRow(notepad, 'System architecture')).toBeVisible()
  expect((await storedDiagram()).title).toBe('System architecture')
})

test('a comment pinned to the canvas is replied to and resolved', async () => {
  await notepad.getByRole('button', { name: 'Comment' }).click()
  const box = (await canvas().boundingBox())!
  await notepad.mouse.click(box.x + 100, box.y + 120)
  await notepad.getByPlaceholder('Add a comment…').fill('Is this the gateway?')
  await notepad.getByPlaceholder('Add a comment…').press('ControlOrMeta+Enter')

  const pin = notepad.getByRole('button', { name: 'Comment: Is this the gateway?' })
  await expect(pin).toBeVisible()
  await pin.click()
  await notepad.getByPlaceholder('Reply…').fill('Yes, behind the load balancer')
  await notepad.getByPlaceholder('Reply…').press('ControlOrMeta+Enter')
  await expect(notepad.locator('.diagram-comment-popover')).toContainText(
    'Yes, behind the load balancer'
  )

  await notepad.getByRole('button', { name: 'Resolve thread' }).click()
  await expect(pin).toHaveCount(0)
  const stored = (await diagramComments()).find((c) => c.body === 'Is this the gateway?')
  expect(stored?.status).toBe('resolved')
})

test('a comment thread on the canvas is deleted', async () => {
  await notepad.getByRole('button', { name: 'Comment' }).click()
  const box = (await canvas().boundingBox())!
  await notepad.mouse.click(box.x + 160, box.y + 160)
  await notepad.getByPlaceholder('Add a comment…').fill('Remove this box?')
  await notepad.getByPlaceholder('Add a comment…').press('ControlOrMeta+Enter')
  await notepad.getByRole('button', { name: 'Comment: Remove this box?' }).click()
  await notepad.getByRole('button', { name: 'Delete thread' }).click()

  await expect(notepad.getByRole('button', { name: 'Comment: Remove this box?' })).toHaveCount(0)
  expect((await diagramComments()).map((c) => c.body)).not.toContain('Remove this box?')
})

test('double-clicking the diagram opens it in its own window', async () => {
  await noteRow(notepad, 'System architecture').dblclick()
  const window = await popoutPage(handle, 'view=diagram')
  await expect(window.locator('.diagram-view__title-btn')).toContainText('System architecture', {
    timeout: 20_000,
  })
  await expect(window.locator('.diagram-view__canvas canvas').first()).toBeVisible()
  await window.close()
})

test('a diagram is archived, restored, archived again and deleted for good', async () => {
  const menu = async (item: string) => {
    await noteRow(notepad, 'System architecture').click({ button: 'right' })
    await notepad.locator('.notepad-context-menu').getByRole('button', { name: item }).click()
  }
  await menu('Archive')
  expect((await storedDiagram()).archivedAt).toBeTruthy()
  await notepad.getByRole('button', { name: 'Archived (1)' }).click()

  await menu('Unarchive')
  await expect(notepad.getByRole('button', { name: /^Archived/ })).toHaveCount(0)
  expect((await storedDiagram()).archivedAt).toBeNull()

  await menu('Archive')
  handle.page.once('dialog', (dialog) => void dialog.accept())
  await menu('Delete')
  await expect(noteRow(notepad, 'System architecture')).toHaveCount(0)
  expect(await diagrams()).toEqual([])
})
