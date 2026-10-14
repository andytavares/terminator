import { test, expect, chromium, type Browser } from '@playwright/test'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { extensionBaseCss } from './extension-base-css'

// A form field with no class of its own, under only the sheet every view loads:
// it must be the themed field, never the white OS widget. The terminal-name
// dialog drew one, because its class lived in a sheet only Settings loads.

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..')

let browser: Browser

test.beforeAll(async () => {
  browser = await chromium.launch()
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

for (const theme of ['dark', 'light']) {
  test(`a classless field is the themed field, in the ${theme} theme`, async () => {
    const context = await browser.newContext()
    const page = await context.newPage()
    await page.setContent(
      `<!doctype html><html data-theme="${theme}"><head><style>${extensionBaseCss(ROOT)}</style></head>
       <body><input id="text" type="text" placeholder="Terminal 4">
       <input id="search" type="search"><textarea id="notes"></textarea>
       <select id="pick"><option>One</option></select></body></html>`
    )
    try {
      const { tokens, ...fields } = await page.evaluate(paintOf)
      for (const [id, paint] of Object.entries(fields)) {
        expect(paint, `#${id}: background, border, text`).toEqual(tokens)
      }
    } finally {
      await context.close()
    }
  })
}
