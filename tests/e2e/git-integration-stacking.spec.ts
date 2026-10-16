import { test, expect, chromium, type Browser } from '@playwright/test'
import { readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { cssFiles, extensionBaseCss } from './extension-base-css'

// Stacking and sizing gates for the git-integration review surfaces.
// elementFromPoint and computed geometry need a rendered document.

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..')

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
      `<style>${extensionBaseCss(ROOT)}</style><style>${allCss()}</style></head><body>${body}</body></html>`
  )
  return { page, context }
}

async function theReviewHeaderMenuIsAboveTheFileToolbar(): Promise<void> {
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
}

/** Run in the page: scrolls the picker, then, for each row checkbox under the
 * owner heading, whether the heading is what a click there would hit. */
function probeUnderHeading(): { n: number; probes: boolean[]; box: number } {
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
}

async function theStickyOwnerHeadingStaysAboveScrolledRows(): Promise<void> {
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
    const hit = await page.evaluate(probeUnderHeading)
    expect(hit.n, 'a row checkbox is scrolled under the heading').toBeGreaterThan(0)
    expect(hit.probes.every(Boolean), 'heading is topmost over scrolled checkboxes').toBe(true)
  } finally {
    await context.close()
  }
}

async function aTextFieldAndASelectAreTheSameHeight(): Promise<void> {
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
}

/** A unified review table as the diff pane renders it: a hunk header, then a line. */
function unifiedReviewTables(): string {
  const cols =
    '<colgroup><col style="width:49px"><col style="width:49px"><col style="width:48px">' +
    '<col class="diff-col--prefix"><col></colgroup>'
  const table = (row: string) =>
    `<table class="diff-table diff-table--review diff-table--row">${cols}<tbody>${row}</tbody></table>`
  return `<div class="review-diff-scroll" style="width:1000px">
    ${table(`<tr><td colspan="5" class="diff-hunk-header rs-hunk-anchor"><div class="rs-hunk-bar">
      <span class="rs-hunk-bar__text">@@ -55,5 +55,5 @@ def load_settings()</span>
      <button class="rs-hunk-tests">Tests</button></div></td></tr>`)}
    ${table(`<tr class="diff-line diff-line--add"><td class="diff-line__old-num">58</td>
      <td class="diff-line__new-num">58</td><td class="rs-gut"></td><td class="diff-line__prefix">+</td>
      <td class="diff-line__content"><pre>audio_device=env.get("EFFECTS_AUDIO_DEVICE", "auto"),</pre></td></tr>`)}
  </div>`
}

async function aUnifiedReviewDiffSpansThePane(): Promise<void> {
  const { page, context } = await render(unifiedReviewTables())
  try {
    const widths = await page.evaluate(() => ({
      pane: document.querySelector('.review-diff-scroll')!.getBoundingClientRect().width,
      hunk: document.querySelector('.diff-hunk-header')!.getBoundingClientRect().width,
      codeRight: document.querySelector('.diff-line__content')!.getBoundingClientRect().right,
    }))
    expect(widths.hunk, 'the hunk header spans every column').toBe(widths.pane)
    expect(widths.codeRight, 'the code column reaches the pane edge').toBe(widths.pane)
  } finally {
    await context.close()
  }
}

async function aGitTabDiffRowIsATableRow(): Promise<void> {
  const { page, context } = await render(`<div class="file-diff-view" style="width:800px">
    <table class="diff-table"><tbody>
      <tr><td colspan="4" class="diff-hunk-header">@@ -1,2 +1,2 @@</td></tr>
      <tr class="diff-line diff-line--add"><td class="diff-line__old-num"></td>
        <td class="diff-line__new-num">1</td><td class="diff-line__prefix">+</td>
        <td class="diff-line__content">const answer = 42</td></tr>
    </tbody></table></div>`)
  try {
    const shown = await page.evaluate(() => ({
      row: getComputedStyle(document.querySelector('tr.diff-line')!).display,
      header: getComputedStyle(document.querySelector('.diff-hunk-header')!).display,
    }))
    expect(shown).toEqual({ row: 'table-row', header: 'table-cell' })
  } finally {
    await context.close()
  }
}

async function aReviewRowKeepsItsActionsClearOfTheSizeColumn(): Promise<void> {
  const { page, context } = await render(`<div class="rd-rows" style="width:1100px">
    <div class="rd-row rd-row--clickable">
      <span class="rd-ti"><span class="rd-t1"><span class="rd-no">#11</span>
        <span>NO/NC switches, per-pin debounce, and show-night reliability</span></span></span>
      <span class="rd-side"><span class="rd-num">+3,068 −201 · 63 files</span>
        <span class="rd-num">~55 min</span></span>
      <span class="rd-actions">
        <button class="tmui-button tmui-button--secondary tmui-button--sm rd-row-action">Open</button>
        <button class="tmui-button tmui-button--secondary tmui-button--sm rd-row-action">Clone and review</button>
      </span>
    </div></div>`)
  try {
    const edges = await page.evaluate(() => ({
      sizeRight: document.querySelector('.rd-side')!.getBoundingClientRect().right,
      actionsLeft: Math.min(
        ...[...document.querySelectorAll('.rd-row-action')].map(
          (b) => b.getBoundingClientRect().left
        )
      ),
    }))
    expect(edges.actionsLeft, 'the first action starts after the size column').toBeGreaterThan(
      edges.sizeRight
    )
  } finally {
    await context.close()
  }
}

/** The flow's steps in order, each titled with the behaviour it checks. */
const STEPS: Array<[title: string, run: () => Promise<void>]> = [
  [
    'the review header menu is drawn above the file toolbar',
    theReviewHeaderMenuIsAboveTheFileToolbar,
  ],
  [
    'the sticky owner heading in the repository picker stays above scrolled rows',
    theStickyOwnerHeadingStaysAboveScrolledRows,
  ],
  ['a text field and a select beside it are the same height', aTextFieldAndASelectAreTheSameHeight],
  [
    'a unified review diff spans the pane, hunk header and code alike',
    aUnifiedReviewDiffSpansThePane,
  ],
  ['a Git tab diff row lays out as a table row', aGitTabDiffRowIsATableRow],
  [
    'a review row with two actions keeps them clear of the size column',
    aReviewRowKeepsItsActionsClearOfTheSizeColumn,
  ],
]

test('the review surfaces stack and size their parts so each can be seen and clicked', async () => {
  test.setTimeout(60_000)
  for (const [title, run] of STEPS) await test.step(title, run)
})
