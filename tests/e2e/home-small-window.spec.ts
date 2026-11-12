import { test, expect } from '@playwright/test'
import { rmSync } from 'node:fs'
import { closeApp, createWorkspace, e2eTempDir, launchApp, type AppHandle } from './helpers'
import { makeRepoWithRemote } from './git-harness'
import { openHome } from './session-views'
import { gitIntegrationFrame } from './extension-page'

// Layout that only a rendered window shows: Start work and Home stay usable when the window is
// small. Everything else about these screens has renderer tests.

const PROMPT = 'Add a retry to fetchUser'

let handle: AppHandle
let repo: string
let bare: string

test.beforeAll(async () => {
  ;({ repo, bare } = makeRepoWithRemote('terminator-e2e-small-window'))
  handle = await launchApp(e2eTempDir('small-window-'))
  await createWorkspace(handle.page, 'agents', repo)
})

test.afterAll(async () => {
  await closeApp(handle)
  for (const dir of [repo, bare]) rmSync(dir, { recursive: true, force: true })
})

/** The Repeat form is the tallest Start work gets: its button stays in the window and the divider
 *  (the side column's left border) runs down to the footer. */
async function theRepeatFormKeepsScheduleOnScreen(): Promise<void> {
  const { page } = handle
  await page.keyboard.press('ControlOrMeta+n')
  const launcher = page.getByRole('dialog', { name: 'Start work' })
  await launcher.getByRole('tab', { name: 'Prompt' }).click()
  await launcher.getByRole('checkbox', { name: 'Use the repo folder' }).check()
  await launcher.getByLabel('What should it do?').fill(PROMPT)
  await launcher.getByRole('radio', { name: 'Repeat' }).click()
  await launcher.getByRole('button', { name: 'Every 30 min' }).click()
  await expect(launcher.getByRole('button', { name: /^Schedule/ })).toBeInViewport()
  const side = await launcher.locator('.start-work__side').boundingBox()
  const footer = await launcher.locator('.start-work__footer').boundingBox()
  expect(Math.abs((side?.y ?? 0) + (side?.height ?? 0) - (footer?.y ?? -10))).toBeLessThan(2)
}

/** The window is small from here on: the app is closed after this test. */
const shrinkTheWindow = () =>
  handle.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(800, 500))

/** Saved from the Repeat form; in a narrow window long cells wrap and the view never scrolls
 *  sideways. */
async function theScheduledTableFitsANarrowWindow(): Promise<void> {
  const { page } = handle
  const launcher = page.getByRole('dialog', { name: 'Start work' })
  await launcher.getByRole('button', { name: /^Schedule/ }).click()
  await expect(launcher).toBeHidden()
  await openHome(page)
  await page.getByRole('radio', { name: 'Scheduled' }).click()
  const row = page
    .getByRole('table', { name: 'Scheduled runs' })
    .getByRole('row', { name: new RegExp(PROMPT) })
  await expect(row).toBeVisible()
  await shrinkTheWindow()
  const overflow = () =>
    page.locator('.scheduled').evaluate((view) => view.scrollWidth - view.clientWidth)
  await expect.poll(overflow).toBeLessThanOrEqual(1)
  await expect(row.getByRole('button', { name: `Actions for ${PROMPT}` })).toBeInViewport()
  await expect(page.getByRole('button', { name: 'New scheduled run' }).first()).toBeInViewport({
    ratio: 1,
  })
}

/** Insights is taller than a short window, so the wheel must move it; a clipped page never moves. */
async function insightsScrollsInAShortWindow(): Promise<void> {
  const { page } = handle
  await page.getByRole('radio', { name: 'Insights' }).click()
  const firstQuestion = page.getByText('How much shipped?')
  await expect(firstQuestion).toBeVisible()
  const topBefore = (await firstQuestion.boundingBox())?.y ?? 0
  // A bare mouse move: hover() scrolls the element into view itself, even where a person cannot.
  await page.mouse.move(400, topBefore + 40)
  await page.mouse.wheel(0, 2000)
  await expect.poll(async () => (await firstQuestion.boundingBox())?.y ?? 0).toBeLessThan(topBefore)
}

/** The Contributions period picker opens under its button, not at the bottom of the frame. */
async function thePeriodPickerOpensUnderItsButton(): Promise<void> {
  const { page } = handle
  await openHome(page)
  await page.getByRole('radio', { name: 'Insights' }).click()
  await expect.poll(() => Boolean(gitIntegrationFrame(handle, 'home'))).toBe(true)
  const frame = gitIntegrationFrame(handle, 'home')!
  const button = frame.getByRole('button', { name: 'This year' })
  await button.click()
  const popover = frame.getByRole('group', { name: 'Period' })
  await expect(popover).toBeVisible()
  const below = await button.boundingBox()
  const opened = await popover.boundingBox()
  expect(Math.abs((opened?.y ?? 0) - ((below?.y ?? 0) + (below?.height ?? 0)))).toBeLessThan(12)
  await page.keyboard.press('Escape')
}

test('Start work and Home fit a small window', async () => {
  await test.step(
    'the Repeat form keeps Schedule on screen and the divider runs to the footer',
    theRepeatFormKeepsScheduleOnScreen
  )
  await test.step(
    'the Scheduled table fits an 800 by 500 window with no sideways scroll',
    theScheduledTableFitsANarrowWindow
  )
  await test.step('Insights scrolls in that short window', insightsScrollsInAShortWindow)
})

test('the Contributions period picker opens under its button', async () => {
  await thePeriodPickerOpensUnderItsButton()
})
