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
let repoPath: string

test.beforeAll(async () => {
  test.setTimeout(120_000)
  const repo = mkdtempSync(join(tmpdir(), 'fdry-type-'))
  repoPath = repo
  execFileSync('git', ['init', '-q', repo])
  execFileSync('git', ['-C', repo, 'commit', '-q', '--allow-empty', '-m', 'initial'])
  handle = await launchApp()
  await createWorkspace(handle.page, 'type', repo)
  const panel = handle.page.locator('[data-extension-panel="terminator.foundry"]')
  await handle.page.locator('button[aria-label="Foundry"]').click()
  await expect(panel).toHaveCount(1, { timeout: 30_000 })
  // The channel answers through the main window's own bridge, which needs
  // nothing from the extension's own WebContentsView, so it is checked
  // first; only once the extension has activated is the view itself worth
  // polling for.
  await expect
    .poll(
      async () =>
        (await handle.page
          .evaluate(() =>
            (
              window as unknown as {
                electronAPI: {
                  extensionBridge: { invoke(c: string, p: unknown): Promise<unknown> }
                }
              }
            ).electronAPI.extensionBridge.invoke('foundry:order.list', {})
          )
          .catch(() => null)) !== null,
      { timeout: 30_000 }
    )
    .toBe(true)
  // The WebContentsView `inFoundry` reaches attaches a little after the
  // channel answers — polled with its rejection caught, since `expect.poll`
  // does not retry a callback that throws, only one whose value mismatches.
  await expect
    .poll(
      async () => {
        try {
          return await inFoundry<number>(`document.querySelectorAll('button').length`)
        } catch {
          return 0
        }
      },
      { timeout: 30_000 }
    )
    .toBeGreaterThan(0)
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
      // 16 and up: the untouched browser default. A rule that deliberately
      // asks for 15 has made a choice; a rule that forgot has not.
      if (size >= 16) {
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

/** Does the view need scrolling, and by how much. */
function overflow(): Promise<{ scroll: number; view: number }> {
  return inFoundry<{ scroll: number; view: number }>(
    '({ scroll: document.documentElement.scrollHeight, view: window.innerHeight })'
  )
}

test('an order fits the view it is shown in', async () => {
  // The rail was 260px whatever the window, so three stacked panels ran past
  // the bottom while the order beside them — text, which does not want 1300px
  // of line length — left the right-hand two thirds empty. Scrolling past dead
  // space, on a screen with room for all of it.
  await inFoundry(`window.electronAPI.extensionBridge.invoke('foundry:order.create', {
    source: { kind: 'typed', text: 'Read the session TTL from the environment' },
    repoPaths: [${'' + JSON.stringify(repoPath) + ''}],
  })`)
  await clickByName('Forge')
  await expect
    .poll(() => inFoundry<number>(`document.querySelectorAll('.fdry-orders button').length`), {
      timeout: 15_000,
    })
    .toBeGreaterThan(0)
  const before = await overflow()
  // eslint-disable-next-line no-console
  console.log(`scrollHeight ${before.scroll} vs viewport ${before.view}`)
  expect(before.scroll, 'the Forge needs scrolling to show one order').toBeLessThanOrEqual(
    before.view + 8
  )
})

test('no text on any Foundry surface renders at the browser default size', async () => {
  const found: Oversized[] = []
  for (const surface of ['Forge', 'Floor', 'Inbox', 'Ledger']) {
    await clickByName(surface)
    // Not every surface is necessarily selectable in this fixture (`Floor`
    // has nothing running to show), so what is waited for is the view
    // settling after the click — two animation frames — rather than that
    // surface's own tab actually becoming active.
    await inFoundry<void>(
      `new Promise(function (resolve) {
        requestAnimationFrame(function () { requestAnimationFrame(resolve) })
      })`
    )
    for (const item of await oversized()) found.push({ ...item, cls: `${surface}: ${item.cls}` })
  }
  // eslint-disable-next-line no-console
  console.log(JSON.stringify(found, null, 1))
  expect(found, 'these render at the untouched 16px default').toEqual([])
})
