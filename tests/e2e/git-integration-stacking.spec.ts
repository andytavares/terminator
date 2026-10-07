import { test, expect, chromium, type Browser } from '@playwright/test'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

// Stacking and sizing gates for the git-integration review surfaces.
// elementFromPoint and computed geometry need a rendered document.

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..')

function baseCss(): string {
  const src = readFileSync(join(ROOT, 'src/main/extensions/extension-view-host.ts'), 'utf8')
  const m = src.match(/export const EXTENSION_BASE_CSS = `([\s\S]*?)\n`/)
  if (!m) throw new Error('EXTENSION_BASE_CSS not found')
  return m[1]
}

function cssFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name)
    if (statSync(p).isDirectory()) return cssFiles(p)
    return name.endsWith('.css') ? [p] : []
  })
}

function allCss(): string {
  const files = [
    ...cssFiles(join(ROOT, 'extensions/git-integration/src/components')),
    join(ROOT, 'packages/extension-ui/src/extension-ui.css'),
  ]
  return files.map((f) => readFileSync(f, 'utf8')).join('\n')
}

let browser: Browser

test.beforeAll(async () => {
  browser = await chromium.launch()
})

test.afterAll(async () => {
  await browser?.close()
})

async function render(body: string) {
  const context = await browser.newContext({ viewport: { width: 1200, height: 700 } })
  const page = await context.newPage()
  await page.setContent(
    `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>stacking</title>` +
      `<style>${baseCss()}</style><style>${allCss()}</style></head><body>${body}</body></html>`
  )
  return { page, context }
}

test('the review header menu is drawn above the file toolbar', async () => {
  const { page, context } = await render(`
    <div class="pr-review-view" style="height:500px;display:flex;flex-direction:column">
      <div class="rh-row">
        <div class="rh-pill-wrap"><button class="rh-pill" style="width:120px">More</button>
          <div class="tmui-popover rh-popover" style="z-index:200">
            <div class="rh-menu"><button class="rh-menu-item">Refresh</button><button class="rh-menu-item">Copy link</button></div>
          </div>
        </div>
      </div>
      <div class="pr-review-panels">
        <main class="pr-review-panel pr-review-panel--centre"><div class="rs-fh">src/main/session/session-store.ts</div></main>
      </div>
    </div>`)
  try {
    const hit = await page.evaluate(() => {
      const item = document.querySelector('.rh-menu-item')!.getBoundingClientRect()
      const el = document.elementFromPoint(item.x + item.width / 2, item.y + item.height / 2)
      return { inPopover: !!el?.closest('.rh-popover'), tag: el?.className }
    })
    expect(hit.inPopover, `topmost element was ${hit.tag}`).toBe(true)
  } finally {
    await context.close()
  }
})

test('the sticky owner heading in the repository picker stays above scrolled rows', async () => {
  const rows = Array.from(
    { length: 30 },
    (_, i) => `<label class="rp-row"><input type="checkbox" /><span>acme/repo-${i}</span></label>`
  ).join('')
  const { page, context } = await render(
    `<div class="rp-list" style="height:200px;overflow:auto">
       <label class="rp-group-label"><input type="checkbox" /><span>acme</span></label>${rows}
     </div>`
  )
  try {
    const hit = await page.evaluate(() => {
      const list = document.querySelector('.rp-list')!
      list.scrollTop = 300
      const checkbox = document.querySelector('.rp-group-label input')!
      const box = checkbox.getBoundingClientRect()
      const heading = document.querySelector('.rp-group-label')!.getBoundingClientRect()
      // Probe every row checkbox that sits under the heading band.
      const under = [...document.querySelectorAll('.rp-row input')].filter((c) => {
        const r = c.getBoundingClientRect()
        return r.top < heading.bottom && r.bottom > heading.top
      })
      const probes = under.map((c) => {
        const r = c.getBoundingClientRect()
        const el = document.elementFromPoint(
          r.x + r.width / 2,
          Math.max(r.y + r.height / 2, heading.top + 1)
        )
        return !!el?.closest('.rp-group-label')
      })
      return { n: under.length, probes, box: box.width }
    })
    expect(hit.n, 'a row checkbox is scrolled under the heading').toBeGreaterThan(0)
    expect(hit.probes.every(Boolean), 'heading is topmost over scrolled checkboxes').toBe(true)
  } finally {
    await context.close()
  }
})

test('a text field and a select beside it are the same height', async () => {
  const { page, context } = await render(`
    <div class="pr-search-row">
      <input class="pr-search-input" type="search" placeholder="Search open PRs">
      <select class="rd-sort"><option>Newest first</option></select>
    </div>
    <div><input type="text"><select><option>Plain</option></select></div>`)
  try {
    const heights = await page.evaluate(() =>
      [...document.querySelectorAll('input, select')].map((e) => e.getBoundingClientRect().height)
    )
    expect(new Set(heights).size, `heights were ${heights.join(', ')}`).toBe(1)
  } finally {
    await context.close()
  }
})
