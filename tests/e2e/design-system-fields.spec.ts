import { test, expect, chromium, type Browser, type Page } from '@playwright/test'
import { readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { extensionBaseCss } from './extension-base-css'
import { misalignedOn } from './control-alignment'

// A form field with no class of its own, under only the sheet every view loads:
// it must be the themed field, never the white OS widget. The terminal-name
// dialog drew one, because its class lived in a sheet only Settings loads.

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..')

let browser: Browser
let page: Page

test.beforeAll(async () => {
  browser = await chromium.launch()
  page = await browser.newPage()
})

test.afterAll(async () => {
  await browser?.close()
})

/** Run in the page: each field's background, border colour and text colour, and the tokens. */
function paintOf(): Record<string, string[]> {
  const swatch = document.createElement('div')
  document.body.appendChild(swatch)
  const resolved = (token: string) => {
    swatch.style.color = `var(${token})`
    return getComputedStyle(swatch).color
  }
  const fields = Object.fromEntries(
    [...document.querySelectorAll('input, textarea, select')].map((field) => {
      const style = getComputedStyle(field)
      return [field.id, [style.backgroundColor, style.borderTopColor, style.color]]
    })
  )
  return {
    ...fields,
    tokens: [
      resolved('--tm-bg-input'),
      resolved('--tm-border-strong'),
      resolved('--tm-text-primary'),
    ],
  }
}

async function classlessFieldIsThemed(theme: 'dark' | 'light'): Promise<void> {
  await page.setContent(
    `<!doctype html><html data-theme="${theme}"><head><style>${extensionBaseCss(ROOT)}</style></head>
     <body><input id="text" type="text" placeholder="Terminal 4">
     <input id="search" type="search"><textarea id="notes"></textarea>
     <select id="pick"><option>One</option></select></body></html>`
  )
  const { tokens, ...fields } = await page.evaluate(paintOf)
  for (const [id, paint] of Object.entries(fields)) {
    expect(paint, `#${id}: background, border, text`).toEqual(tokens)
  }
}

async function controlsOfOneSizeAreOneHeight(): Promise<void> {
  await page.setContent(
    `<!doctype html><html><head><style>${extensionBaseCss(ROOT)}</style>
     <style>${readFileSync(join(ROOT, 'packages/extension-ui/src/extension-ui.css'), 'utf8')}</style></head>
     <body><div id="md"><input type="text"><select><option>One</option></select>
       <button class="tmui-button tmui-button--primary tmui-button--md">Add</button>
       <button class="tmui-icon-button" aria-label="Close"><svg></svg></button></div>
     <div id="sm"><button class="tmui-button tmui-button--sm">History</button>
       <button class="tmui-icon-button tmui-icon-button--sm" aria-label="Back"><svg></svg></button></div>
     </body></html>`
  )
  const heights = await page.evaluate(() =>
    ['md', 'sm'].map((row) =>
      [...document.getElementById(row)!.children].map((el) => el.getBoundingClientRect().height)
    )
  )
  for (const row of heights) expect(new Set(row).size, `heights were ${row.join(', ')}`).toBe(1)
}

async function auditReportsOnlyMisalignedControls(): Promise<void> {
  await page.setContent(
    `<!doctype html><html><head><style>* { box-sizing: border-box }</style></head><body>
     <div style="display:flex;gap:8px;align-items:center">
       <input style="height:28px;border:1px solid" placeholder="Add task">
       <button style="height:34px;border:1px solid">Add</button></div>
     <div style="display:flex;gap:8px;align-items:center">
       <input style="height:28px;border:1px solid" placeholder="Filter">
       <button style="height:28px;border:1px solid">Go</button>
       <button style="border:0;background:none">Use default</button></div></body></html>`
  )
  const found = await misalignedOn(page, 'fixture')
  expect(found).toHaveLength(1)
  expect(found[0]).toContain('"Add task" (28px) beside button. "Add" (34px)')
}

test('form controls under the shared sheet are themed, one height, and audited for alignment', async () => {
  for (const theme of ['dark', 'light'] as const) {
    await test.step(`a classless field is the themed field, in the ${theme} theme`, () =>
      classlessFieldIsThemed(theme))
  }
  await test.step(
    'a field, a button and an icon button of one size are one height',
    controlsOfOneSizeAreOneHeight
  )
  await test.step(
    'the alignment audit reports controls that do not line up, and only those',
    auditReportsOnlyMisalignedControls
  )
})
