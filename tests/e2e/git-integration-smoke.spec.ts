import { test, expect } from '@playwright/test'
import { execSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { AppHandle, launchApp, closeApp, createWorkspace } from './helpers'

/**
 * The whole-class checks `extension-smoke.spec.ts` runs, for the extension it
 * cannot reach.
 *
 * Git Integration contributes no global tab, so the smoke suite never opened
 * it — which is why its unstyled caret button and its overlapping status badge
 * both shipped. Its own file rather than a case inside `merge-flow.spec.ts`,
 * because showing and hiding the sidebar is shared state and toggling it
 * mid-file broke the tests either side.
 *
 * Each view is measured only while it is on screen: a WebContentsView the host
 * has hidden stops recalculating style, and every control in it then reads as
 * unstyled — a property of the measurement, not of the CSS.
 */

let handle: AppHandle
let repo: string

const PANEL = '[data-extension-panel="terminator.git-integration"]'

const PROBE = `(() => {
  const bareButtons = []
  for (const el of document.querySelectorAll('button')) {
    const r = el.getBoundingClientRect()
    if (r.width < 1 || r.height < 1) continue
    const cs = getComputedStyle(el)
    if (cs.appearance === 'auto' || cs.borderTopStyle === 'outset') {
      bareButtons.push((el.className || el.getAttribute('aria-label') || 'button').toString().split(' ')[0])
    }
  }
  const unstyledInputs = []
  for (const el of document.querySelectorAll('input:not([type=checkbox]):not([type=radio]):not([type=hidden]), textarea, select')) {
    const r = el.getBoundingClientRect()
    if (r.width < 1 || r.height < 1) continue
    const cs = getComputedStyle(el)
    if (cs.backgroundColor === 'rgb(255, 255, 255)' || cs.borderTopStyle === 'inset') {
      unstyledInputs.push((el.className || el.tagName).toString().split(' ')[0])
    }
  }
  const oversizedIcons = []
  for (const svg of document.querySelectorAll('svg')) {
    if (Math.round(svg.getBoundingClientRect().height) === 24) {
      oversizedIcons.push((svg.parentElement?.className || 'svg').toString().split(' ')[0])
    }
  }
  const sideScrollers = []
  for (const el of document.querySelectorAll('.tmui-dialog__panel, [role=dialog]')) {
    if (el.scrollWidth - el.clientWidth > 1) {
      sideScrollers.push((el.className || 'dialog') + ' +' + (el.scrollWidth - el.clientWidth) + 'px')
    }
  }
  return {
    bodyLength: document.body.innerText.length,
    bareButtons,
    unstyledInputs,
    oversizedIcons,
    sideScrollers,
  }
})()`

interface Report {
  bodyLength: number
  bareButtons: string[]
  unstyledInputs: string[]
  oversizedIcons: string[]
  sideScrollers: string[]
}

function inGit(viewParam: string, script: string): Promise<Report> {
  return handle.app.evaluate(
    async ({ webContents }, { param, src }) => {
      const v = webContents
        .getAllWebContents()
        .find(
          (w) =>
            !w.isDestroyed() &&
            w.getURL().includes('git-integration') &&
            w.getURL().includes(`view=${param}`)
        )
      if (!v) throw new Error(`no git-integration view for view=${param}`)
      return v.executeJavaScript(src) as Promise<unknown>
    },
    { param: viewParam, src: script }
  ) as Promise<Report>
}

test.beforeAll(async () => {
  repo = mkdtempSync(join(tmpdir(), 'terminator-e2e-gitsmoke-'))
  const run = (c: string) => execSync(c, { cwd: repo })
  run('git init -b main')
  run('git config user.email "test@test.com"')
  run('git config user.name "Test"')
  writeFileSync(join(repo, 'README.md'), '# Test\n')
  run('git add -A')
  run('git commit -m "initial"')
  // Something uncommitted, so the staging list and commit controls render.
  writeFileSync(join(repo, 'changed.txt'), 'content\n')

  handle = await launchApp()
  await createWorkspace(handle.page, 'Git Smoke', repo)
  await handle.page.locator('.branch-row').first().click()
  await handle.page.waitForTimeout(1500)
})

test.afterAll(async () => {
  await closeApp(handle)
  if (repo) rmSync(repo, { recursive: true, force: true })
})

function assertClean(view: string, report: Report): void {
  expect(report.bodyLength, `${view} rendered an empty document`).toBeGreaterThan(20)
  expect(
    report.bareButtons,
    `${view} has buttons rendering the browser's native control: ${report.bareButtons.join(', ')}`
  ).toHaveLength(0)
  expect(
    report.unstyledInputs,
    `${view} has controls with browser-default styling: ${report.unstyledInputs.join(', ')}`
  ).toHaveLength(0)
  expect(
    report.oversizedIcons,
    `${view} draws icons at lucide's 24px fallback: ${report.oversizedIcons.join(', ')}`
  ).toHaveLength(0)
  expect(
    report.sideScrollers,
    `${view} has a dialog that scrolls sideways: ${report.sideScrollers.join(', ')}`
  ).toHaveLength(0)
}

test('the git sidebar renders, and everything on it is styled', async () => {
  const sidebar = handle.page.locator(`${PANEL}[data-view-param="sidebar"]`)
  if ((await sidebar.count()) === 0) await handle.page.keyboard.press('Meta+Shift+G')
  await expect(sidebar).toHaveCount(1, { timeout: 15000 })
  await handle.page.waitForTimeout(2500)
  assertClean('sidebar', await inGit('sidebar', PROBE))
})

test('the git project view renders, and everything on it is styled', async () => {
  await handle.page
    .locator('.tab-bar--primary .tab-bar__tab')
    .filter({ hasText: 'Git' })
    .first()
    .click()
  await expect(handle.page.locator(`${PANEL}[data-view-param="project"]`)).toHaveCount(1, {
    timeout: 15000,
  })
  await handle.page.waitForTimeout(2500)
  assertClean('project', await inGit('project', PROBE))
})
