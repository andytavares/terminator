import { test, expect } from '@playwright/test'
import { launchApp, closeApp, createWorkspace, type AppHandle } from './helpers'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { execFileSync } from 'node:child_process'

// Nothing in an extension view should render at the browser's default size.
//
// The shared extension stylesheet sets `body`'s family, colour and background
// and **no size**, so any rule that forgets one lands on 16px — beside a
// product drawn at 11-13px. That is not subtle and it shipped: a button in the
// Ledger read half again as large as the table under it, and it was found by
// somebody looking at the screen rather than by any of 8,000 tests.
//
// Measured rather than eyeballed, so it covers every surface at once and every
// element on them, not the two a screenshot happened to include.

let handle: AppHandle

test.beforeAll(async () => {
  test.setTimeout(120_000)
  const repo = mkdtempSync(join(tmpdir(), 'fdry-type-'))
  execFileSync('git', ['init', '-q', repo])
  execFileSync('git', ['-C', repo, 'commit', '-q', '--allow-empty', '-m', 'initial'])
  handle = await launchApp()
  await createWorkspace(handle.page, 'type', repo)
  await handle.page.waitForTimeout(2000)
  await handle.page.locator('button[aria-label="Foundry"]').click()
  await handle.page.waitForTimeout(3000)
})

test.afterAll(async () => {
  if (handle !== undefined) await closeApp(handle)
})

function inFoundry<T>(script: string): Promise<T> {
  return handle.app.evaluate(async ({ webContents }, src) => {
    const view = webContents
      .getAllWebContents()
      .find((wc) => !wc.isDestroyed() && wc.getURL().includes('foundry'))
    if (!view) throw new Error('the Foundry view is not loaded')
    return view.executeJavaScript(src) as Promise<unknown>
  }, script) as Promise<T>
}

interface Oversized {
  readonly tag: string
  readonly cls: string
  readonly text: string
  readonly size: number
}

/** Every element whose own text renders at the untouched browser default. */
function oversized(): Promise<Oversized[]> {
  return inFoundry<Oversized[]>(`(function () {
    var out = []
    var all = document.querySelectorAll('body *')
    for (var i = 0; i < all.length; i++) {
      var el = all[i]
      // Only elements that draw their own text, so a container is not blamed
      // for a child that sets its own size.
      var own = ''
      for (var j = 0; j < el.childNodes.length; j++) {
        if (el.childNodes[j].nodeType === 3) own += el.childNodes[j].textContent
      }
      if (own.trim() === '') continue
      var size = parseFloat(getComputedStyle(el).fontSize)
      if (size >= 15) {
        out.push({
          tag: el.tagName.toLowerCase(),
          cls: String(el.className || ''),
          text: own.trim().slice(0, 40),
          size: size,
        })
      }
    }
    return out
  })()`)
}

function clickByName(name: string): Promise<boolean> {
  return inFoundry<boolean>(`(function () {
    var all = document.querySelectorAll('button')
    for (var i = 0; i < all.length; i++) {
      var label = (all[i].getAttribute('aria-label') || all[i].textContent || '').trim()
      if (label === ${'' + JSON.stringify(name) + ''}) { all[i].click(); return true }
    }
    return false
  })()`)
}

test('no text on any Foundry surface renders at the browser default size', async () => {
  const found: Oversized[] = []
  for (const surface of ['Forge', 'Floor', 'Inbox', 'Ledger']) {
    await clickByName(surface)
    await handle.page.waitForTimeout(600)
    for (const item of await oversized()) found.push({ ...item, cls: `${surface}: ${item.cls}` })
  }
  // eslint-disable-next-line no-console
  console.log(JSON.stringify(found, null, 1))
  expect(found, 'these render at the untouched 16px default').toEqual([])
})
