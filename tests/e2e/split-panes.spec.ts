import { test, expect } from '@playwright/test'
import { AppHandle, launchApp, closeApp, createWorkspace } from './helpers'

/**
 * A split pane you can see, reach and close.
 *
 * Splitting worked, but the pane it made existed on screen and nowhere else:
 * the sidebar reported a count and stopped at the branch, the pane's titlebar
 * carried a name and nothing else, and the only way out was Cmd+W — which is
 * invisible, and which reads as "close the tab", the tab being the thing you
 * are trying not to lose.
 *
 * `splitSession` already pinned every pane to its root session through
 * `parentSessionId`, one level deep. The tree was in the data; nothing drew it.
 */

let handle: AppHandle

test.beforeAll(async () => {
  handle = await launchApp()
  await createWorkspace(handle.page, 'terminator', process.cwd())
  await handle.page.locator('.branch-row').first().click()
  await handle.page.waitForTimeout(3000)
})

test.afterAll(async () => {
  await closeApp(handle)
})

test('a split pane is listed under the terminal it came from, and can be hidden', async () => {
  await handle.page.keyboard.press('Meta+d')
  await expect(handle.page.locator('.xterm')).toHaveCount(2, { timeout: 15000 })

  const disclosure = handle.page.locator('.branch-row__disclosure').first()
  await expect(disclosure, 'a branch with terminals offers a disclosure').toBeVisible()

  // Collapsed by default: the sidebar still stops at the branch until asked.
  await expect(handle.page.locator('.terminal-row')).toHaveCount(0)

  await disclosure.click()
  const rows = handle.page.locator('.terminal-row')
  await expect(rows).toHaveCount(2, { timeout: 10000 })

  // The pane is nested under its root, not a sibling of it.
  await expect(rows.nth(0)).not.toHaveClass(/terminal-row--nested/)
  await expect(rows.nth(1)).toHaveClass(/terminal-row--nested/)

  // And it collapses again.
  await disclosure.click()
  await expect(handle.page.locator('.terminal-row')).toHaveCount(0)
})

test('the tree steps in at every level', async () => {
  await handle.page.locator('.branch-row__disclosure').first().click()
  await expect(handle.page.locator('.terminal-row')).toHaveCount(2, { timeout: 10000 })

  const depths = await handle.page.evaluate(() => {
    const left = (sel: string) => {
      const el = document.querySelector(sel)
      return el ? Math.round(el.getBoundingClientRect().left) : -1
    }
    return {
      repo: left('.repo-header__chevron'),
      branch: left('.branch-row__disclosure'),
      terminal: left('.terminal-row__gutter'),
      pane: left('.terminal-row--nested .terminal-row__gutter'),
    }
  })
  // Each level sits to the right of the one above it. Without this a pane read
  // as a sibling of the branch rather than as something inside it.
  expect(depths.repo).toBeLessThan(depths.branch)
  expect(depths.branch).toBeLessThan(depths.terminal)
  expect(depths.terminal).toBeLessThan(depths.pane)
})

test('a pane can be closed from the sidebar and from its own titlebar', async () => {
  await expect(handle.page.locator('.leaf-pane__close')).toHaveCount(2)

  const rows = handle.page.locator('.terminal-row')
  await expect(rows).toHaveCount(2)
  await rows.last().locator('.terminal-row__close').click({ force: true })

  await expect(rows, 'closing the pane removes its row').toHaveCount(1, { timeout: 10000 })
  // One pane left means no split, so no per-pane titlebars either.
  await expect(handle.page.locator('.xterm')).toHaveCount(1, { timeout: 10000 })
})
