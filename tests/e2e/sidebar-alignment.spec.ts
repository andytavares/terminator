import { test, expect } from '@playwright/test'
import { AppHandle, launchApp, closeApp, createWorkspace } from './helpers'

/**
 * One column for the numbers, one for the controls.
 *
 * Three row types reserved their right edge three different ways: the repo
 * header sized its action group to its content, so a repo contributing three
 * actions pushed its count further left than one contributing two; the branch
 * row reserved a flat 16px; the scratch row reserved nothing and sat ~100px
 * clear of the rest. Nothing lined up with anything.
 *
 * Asserted by measuring the rendered geometry, because that is the only thing
 * that answers it — the CSS reads as though it aligns either way.
 */

let handle: AppHandle

test.beforeAll(async () => {
  handle = await launchApp()
  await createWorkspace(handle.page, 'terminator', process.cwd())
  // A second repo with a longer name: the count must not follow the name.
  await createWorkspace(handle.page, 'A Much Longer Repo Name', process.cwd())
  await handle.page.waitForTimeout(2500)
})

test.afterAll(async () => {
  await closeApp(handle)
})

const COUNTS =
  '.repo-header__count, .branch-row__count, .branch-row__age, .unified-sidebar__scratch-count'

test('every count in the sidebar shares one right edge', async () => {
  const rights = await handle.page.evaluate((sel) => {
    const out: number[] = []
    for (const el of document.querySelectorAll(sel)) {
      const b = el.getBoundingClientRect()
      if (b.width < 1) continue
      out.push(Math.round(b.right))
    }
    return [...new Set(out)]
  }, COUNTS)
  expect(rights.length, `counts sit at ${rights.length} different right edges: ${rights}`).toBe(1)
})

test('every count is set in the same type', async () => {
  const styles = await handle.page.evaluate((sel) => {
    const out: string[] = []
    for (const el of document.querySelectorAll(sel)) {
      if (el.getBoundingClientRect().width < 1) continue
      const cs = getComputedStyle(el)
      out.push(`${cs.fontSize}/${cs.fontFamily.split(',')[0]}`)
    }
    return [...new Set(out)]
  }, COUNTS)
  expect(styles.length, `counts are set in ${styles.length} different types: ${styles}`).toBe(1)
})

test('every "new" control shares one column', async () => {
  const rights = await handle.page.evaluate(() => {
    // Reveal the hover groups: they are in flow at rest, but transparent.
    for (const el of document.querySelectorAll<HTMLElement>(
      '.repo-header__hover, .branch-row__hover, .unified-sidebar__scratch-add'
    )) {
      el.style.opacity = '1'
    }
    const out: number[] = []
    for (const el of document.querySelectorAll(
      '.repo-header__action, .branch-row__action, .unified-sidebar__scratch-add'
    )) {
      if (!/^New /.test(el.getAttribute('aria-label') || '')) continue
      const b = el.getBoundingClientRect()
      if (b.width < 1) continue
      out.push(Math.round(b.right))
    }
    return [...new Set(out)]
  })
  expect(rights.length, `the + controls sit at ${rights.length} different edges: ${rights}`).toBe(1)
})

test('a repo header says whether it is collapsed without being pointed at', async () => {
  const chevrons = await handle.page.evaluate(() =>
    [...document.querySelectorAll('.repo-header__chevron')].map((e) => ({
      left: Math.round(e.getBoundingClientRect().left),
      opacity: Number(getComputedStyle(e).opacity),
    }))
  )
  expect(chevrons.length).toBeGreaterThan(0)
  for (const c of chevrons)
    expect(c.opacity, 'the chevron must be drawn at rest').toBeGreaterThan(0)
  expect(new Set(chevrons.map((c) => c.left)).size, 'chevrons must share one column').toBe(1)
})
