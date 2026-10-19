import { test, expect, type Page } from '@playwright/test'
import {
  AppHandle,
  launchApp,
  closeApp,
  createWorkspace,
  addAndSelectProject,
  e2eTempDir,
} from './helpers'
import { openHome, openOverview, runInVisibleTerminal } from './session-views'

// A session's live terminal shown in a box (Overview tile, Home's expanded row) is the DOM
// renderer, which measures glyphs at the moment it is built. The session here belongs to a
// branch that is not on screen, so its tab is hidden when the preview takes the terminal.

const PROBE = 'SPACING-PROBE-0123456789'

/** Run in the page: the probe row's drawn width, and the width of the same text set in its font. */
function probeWidths(text: string): { drawn: number; expected: number } | null {
  const row = [...document.querySelectorAll('.live-preview .xterm-rows > div')].find((r) =>
    r.textContent?.includes(text)
  )
  if (!(row instanceof HTMLElement)) return null
  const scale = row.getBoundingClientRect().width / row.offsetWidth
  const range = document.createRange()
  range.selectNodeContents(row.firstElementChild ?? row)
  const reference = document.createElement('span')
  reference.style.cssText = 'position:absolute;white-space:pre;visibility:hidden'
  const { fontFamily, fontSize } = getComputedStyle(row)
  Object.assign(reference.style, { fontFamily, fontSize })
  reference.textContent = row.textContent
  document.body.appendChild(reference)
  const expected = reference.getBoundingClientRect().width
  reference.remove()
  return { drawn: range.getBoundingClientRect().width / scale, expected }
}

async function expectNoGapsBetweenLetters(page: Page): Promise<void> {
  await expect.poll(() => page.evaluate(probeWidths, PROBE)).not.toBeNull()
  const widths = (await page.evaluate(probeWidths, PROBE))!
  expect(widths.drawn).toBeCloseTo(widths.expected, -1)
}

async function sessionOnAnotherBranch(page: Page): Promise<void> {
  // The app opens on Home, which hides the sidebar these steps click; the store reads settings on load.
  await page.evaluate(() =>
    window.electronAPI.settings.updateGlobal({ ui: { hideSidebarOnHome: false } })
  )
  await page.reload()
  await expect(page.locator('.unified-sidebar--hidden')).toHaveCount(0)
  await createWorkspace(page, 'Spacing', e2eTempDir('spacing-'))
  await addAndSelectProject(page, 'Spacing', 'live')
  await runInVisibleTerminal(page, `echo ${PROBE}`)
  await addAndSelectProject(page, 'Spacing', 'other')
}

test('the Overview wall draws a tile with no gaps between letters', async () => {
  test.setTimeout(90_000)
  const handle: AppHandle = await launchApp()
  try {
    await sessionOnAnotherBranch(handle.page)
    await openOverview(handle.page)
    await expectNoGapsBetweenLetters(handle.page)
  } finally {
    await closeApp(handle)
  }
})

test("Home's expanded row draws its preview with no gaps between letters", async () => {
  test.setTimeout(90_000)
  const handle: AppHandle = await launchApp()
  try {
    const { page } = handle
    await sessionOnAnotherBranch(page)
    await openHome(page)
    await page
      .getByRole('rowgroup', { name: 'Spacing / live' })
      .getByRole('gridcell', { name: 'Terminal 1', exact: true })
      .click()
    await expectNoGapsBetweenLetters(page)
  } finally {
    await closeApp(handle)
  }
})
