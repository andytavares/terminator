import { test, expect } from '@playwright/test'
import { execSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { AppHandle, launchApp, closeApp, createWorkspace } from './helpers'

// End-to-end cover for the board. The single-grid arrangement exists to keep a
// card's DOM node alive across a state change, and that is only really provable
// against the running app — a jsdom test can assert the node identity but not
// that the live terminal preview survived it.

let handle: AppHandle
let repo: string

test.beforeAll(async () => {
  repo = mkdtempSync(join(tmpdir(), 'board-'))
  const run = (c: string): void => {
    execSync(c, { cwd: repo, stdio: 'ignore' })
  }
  run('git init -b main')
  run('git config user.email "test@test.com"')
  run('git config user.name "Test"')
  writeFileSync(join(repo, 'README.md'), '# Test\n')
  run('git add -A')
  run('git commit -m "initial"')

  handle = await launchApp()
  await createWorkspace(handle.page, 'Repo One', repo)
})

test.afterAll(async () => {
  await closeApp(handle)
  if (repo) rmSync(repo, { recursive: true, force: true })
})

const openBoard = async (): Promise<void> => {
  // Idempotent: the band entry toggles, and these tests share one app, so
  // clicking an already-active Overview would navigate away from it.
  const entry = handle.page.locator('.app-band__entry[aria-label="Overview"]')
  if ((await entry.getAttribute('aria-current')) !== 'page') await entry.click()
  await handle.page.waitForSelector('.board, .board-empty', { timeout: 10000 })
  const board = handle.page.locator('.board')
  if (await board.isVisible()) return
  await handle.page.getByRole('button', { name: 'Board' }).click()
}

/**
 * Selecting a branch starts its terminal, which is what puts a card on the
 * board. The tab bar is the signal rather than a sidebar row, because the
 * sidebar stops listing terminals in this same feature.
 */
const startTerminal = async (): Promise<void> => {
  await handle.page
    .locator('.session-group:not(:has(.session-group)) .session-group__header')
    .first()
    .click()
  await handle.page.waitForSelector('.tab-bar__tab', { timeout: 15000 })
}

test('the overview opens on the board', async () => {
  await openBoard()
  await expect(handle.page.locator('.board, .board-empty')).toBeVisible()
  await expect(handle.page.getByRole('button', { name: 'Board' })).toHaveAttribute(
    'aria-pressed',
    'true'
  )
})

test('with nothing running it offers one line and one action', async () => {
  await openBoard()
  const empty = handle.page.locator('.board-empty')
  if (await empty.isVisible()) {
    await expect(empty).toContainText('No terminals running')
    await expect(empty.getByRole('button', { name: /start a branch/i })).toBeVisible()
  }
})

test('a running terminal lands in a lane with a header, a label and a count', async () => {
  await startTerminal()
  await openBoard()

  const head = handle.page.locator('.board__lane-head').first()
  await expect(head).toBeVisible()
  await expect(head.locator('.board__lane-label')).not.toBeEmpty()
  await expect(head.locator('.board__lane-count')).not.toBeEmpty()

  const card = handle.page.locator('.board__slot').first()
  await expect(card).toBeVisible()
  await expect(card.locator('.session-tile__source')).not.toBeEmpty()
})

test('every card is a direct child of the one grid — a lane is a column', async () => {
  await startTerminal()
  await openBoard()
  const misplaced = await handle.page.evaluate(() => {
    const grid = document.querySelector('.board')
    if (grid === null) return -1
    return [...document.querySelectorAll('.board__slot')].filter((c) => c.parentElement !== grid)
      .length
  })
  expect(misplaced).toBe(0)
})

test('a card is positioned by grid placement, not by nesting', async () => {
  await startTerminal()
  await openBoard()
  const placed = await handle.page.evaluate(() => {
    const slot = document.querySelector<HTMLElement>('.board__slot')
    return slot === null ? null : { col: slot.style.gridColumn, row: slot.style.gridRow }
  })
  expect(placed).not.toBeNull()
  expect(placed!.col).not.toBe('')
  expect(placed!.row).not.toBe('')
})

test('a card keeps its DOM node across a board re-render', async () => {
  await startTerminal()
  await openBoard()

  const marked = await handle.page.evaluate(() => {
    const slot = document.querySelector<HTMLElement>('.board__slot')
    if (slot === null) return null
    // Marking the node itself: this survives only if React never re-created or
    // re-parented it, which is the whole point of the single grid.
    slot.dataset.e2eMark = 'kept'
    return { id: slot.dataset.sessionId ?? '', lane: slot.dataset.lane ?? '' }
  })
  test.skip(marked === null, 'no terminal on the board to observe')
  const id = marked!.id

  // Force a board re-render without unmounting it, by hiding a lane the card is
  // NOT in. A lane header never contains a card here — they are siblings in the
  // one grid — so the lane has to be chosen by its label, not by containment.
  const otherLane = handle.page
    .locator(`.board__lane-head:not([data-lane="${marked!.lane}"])`)
    .first()
  await otherLane.locator('.board__lane-toggle').click({ force: true })

  const survived = await handle.page.evaluate((sessionId: string) => {
    const slot = document.querySelector<HTMLElement>(`.board__slot[data-session-id="${sessionId}"]`)
    return slot === null ? null : slot.dataset.e2eMark === 'kept'
  }, id)

  expect(survived).toBe(true)
})

test('lane glyphs carry no colour of their own', async () => {
  await openBoard()
  const coloured = await handle.page.evaluate(() => {
    const glyphs = [...document.querySelectorAll('.board__lane-glyph')]
    return glyphs.filter((g) => {
      const stroke = getComputedStyle(g).stroke
      // Every glyph must inherit currentColor rather than set a hue of its own.
      return stroke !== '' && getComputedStyle(g).color !== stroke && stroke !== 'none'
    }).length
  })
  expect(coloured).toBe(0)
})

test('the layout can be switched to the flat list and back', async () => {
  await openBoard()
  await handle.page.getByRole('button', { name: 'List' }).click()
  await expect(handle.page.locator('.overview-screen__grid, .overview-screen__empty')).toBeVisible()
  await handle.page.getByRole('button', { name: 'Board' }).click()
  await expect(handle.page.locator('.board, .board-empty')).toBeVisible()
})
