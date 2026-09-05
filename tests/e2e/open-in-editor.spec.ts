import { test, expect } from '@playwright/test'
import { AppHandle, launchApp, closeApp, createWorkspace } from './helpers'

// End-to-end cover for opening a folder in the user's editor. Detection reads
// the real machine, so these assert the shape of what comes back rather than a
// particular editor — a CI box may have none, and that is a valid answer.

let handle: AppHandle

test.beforeAll(async () => {
  handle = await launchApp()
  await createWorkspace(handle.page, 'Editor Test', handle.userDataDir)
  await handle.page.locator('.repo-header').first().hover()
  await handle.page.locator('.repo-header__action[aria-label^="New branch in"]').first().click()
  await handle.page.getByPlaceholder('My branch').fill('demo-branch')
  await handle.page.click('.dialog__btn-primary')
  await expect(handle.page.locator('.branch-row').first()).toBeVisible()
})

test.afterAll(async () => {
  await closeApp(handle)
})

test('detection answers with an editor or an honest null', async () => {
  const result = await handle.page.evaluate(() => window.electronAPI.editor.detect())
  expect(result).toHaveProperty('editor')
  if (result.editor !== null) {
    expect(typeof result.editor.id).toBe('string')
    expect(typeof result.editor.name).toBe('string')
  }
})

test('a branch offers to open its folder, named after the editor', async () => {
  const { editor } = await handle.page.evaluate(() => window.electronAPI.editor.detect())
  await handle.page.locator('.branch-row').first().click({ button: 'right' })
  const items = await handle.page.locator('.ctx-menu__item').allTextContents()
  expect(items.some((i) => i.startsWith('Open in'))).toBe(true)
  if (editor !== null) expect(items).toContain(`Open in ${editor.name}`)
  await handle.page.keyboard.press('Escape')
})

test('a repo offers the same on its header', async () => {
  await handle.page.locator('.repo-header').first().click({ button: 'right' })
  const items = await handle.page.locator('.ctx-menu__item').allTextContents()
  expect(items.some((i) => i.startsWith('Open in'))).toBe(true)
  await handle.page.keyboard.press('Escape')
})

test('a folder that is not there is refused rather than launching anything', async () => {
  const result = await handle.page.evaluate(() =>
    window.electronAPI.editor.open('/definitely/not/a/real/folder')
  )
  expect(result).toEqual({ error: 'FOLDER_NOT_FOUND' })
})

// The renderer sends a folder and nothing else — the main process decides what
// to launch, from a fixed list. A channel that took a command would be a way to
// run anything.
test('the channel takes a folder, never a command', async () => {
  const result = await handle.page.evaluate(() =>
    // @ts-expect-error deliberately wrong shape
    window.electronAPI.editor.open('')
  )
  expect(result).toEqual({ error: 'VALIDATION_ERROR' })
})
