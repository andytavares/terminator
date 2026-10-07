import { test, expect, chromium, type Browser, type Page } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'
import { build } from 'esbuild'
import { readFileSync, readdirSync, mkdirSync, statSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

// WCAG 2.1 AA contrast gate for the git-integration surfaces, in both themes.
// It renders the real components with fixture data in plain Chromium (no
// Electron): the colours in these stylesheets are rgba() layers and
// color-mix() results, so only a rendered document shows what a reader sees.
// axe-core covers text contrast (1.4.3); it does not cover state indicators
// (1.4.11), so the selected row is measured here against its panel.

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const COMPONENTS = join(ROOT, 'extensions/git-integration/src/components')
const SHOTS = join(ROOT, 'test-results/git-integration-contrast')

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

// Computed in the page: composite every translucent layer from `el` up onto the
// first opaque one. Chromium reports color-mix() as color(srgb r g b / a).
const MEASURE = `(() => {
  function parse(c) {
    const nums = c.match(/-?[\\d.]+(?:e-?\\d+)?%?/g) || []
    const isSrgb = c.startsWith('color(srgb')
    const v = (isSrgb ? nums.slice(0, 3).map((n) => parseFloat(n) * 255) : nums.slice(0, 3).map(parseFloat))
    const alphaIdx = isSrgb ? 3 : 3
    let a = nums.length > alphaIdx ? parseFloat(nums[alphaIdx]) : 1
    if (nums.length > alphaIdx && nums[alphaIdx].endsWith('%')) a /= 100
    return { r: v[0], g: v[1], b: v[2], a }
  }
  function over(fg, bg) {
    return {
      r: fg.r * fg.a + bg.r * (1 - fg.a),
      g: fg.g * fg.a + bg.g * (1 - fg.a),
      b: fg.b * fg.a + bg.b * (1 - fg.a),
      a: 1,
    }
  }
  function composite(el) {
    const layers = []
    for (let n = el; n; n = n.parentElement) {
      const c = parse(getComputedStyle(n).backgroundColor)
      if (c.a > 0) {
        layers.push(c)
        if (c.a >= 1) break
      }
    }
    let base = { r: 255, g: 255, b: 255, a: 1 }
    for (let i = layers.length - 1; i >= 0; i--) base = over(layers[i], base)
    return base
  }
  function lum({ r, g, b }) {
    const f = (x) => {
      const s = x / 255
      return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4)
    }
    return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b)
  }
  return (selector, indicator) => {
    const row = document.querySelector(selector)
    if (!row) return null
    const fill = indicator === 'border' ? over(parse(getComputedStyle(row).borderTopColor), composite(row.parentElement)) : composite(row)
    const a = lum(fill)
    const b = lum(composite(row.parentElement))
    const [hi, lo] = a > b ? [a, b] : [b, a]
    return { ratio: (hi + 0.05) / (lo + 0.05) }
  }
})()`

interface Surface {
  name: string
  /** The selected row, for the 1.4.11 check; absent where the surface has none. */
  selected?: string
  /** What marks the row as selected: its fill (default) or its border. */
  indicator?: 'background' | 'border'
  /** Wait until the surface has rendered its populated state. */
  ready: string
  act?: (page: Page) => Promise<void>
}

const SURFACES: Surface[] = [
  {
    name: 'pr-rail',
    selected: '.full-file-row--active',
    ready: '.full-file-row--active',
  },
  {
    name: 'git-view',
    selected: '.staging-area__file-row--selected',
    ready: '.staging-area__file-row--selected',
  },
  {
    name: 'merge-flow',
    selected: '.conflict-hub__file-card--highlighted',
    indicator: 'border',
    ready: '[data-testid="conflict-file-row"]',
  },
  { name: 'reviews', ready: '.rd-row' },
  { name: 'review-footer', ready: '.rf-btn.rf-pri' },
  { name: 'review-queue', ready: '.rd-btn.rd-pri' },
  { name: 'repo-picker', ready: '.rp-row' },
  {
    name: 'reviews-mine',
    ready: '.rd-row',
    act: async (page) => {
      await page.getByRole('tab', { name: /My PRs/ }).click()
      await page.waitForSelector('.rd-row')
    },
  },
]

let browser: Browser
let bundleJs = ''
let bundleCss = ''

test.beforeAll(async () => {
  mkdirSync(SHOTS, { recursive: true })
  const cssImports = cssFiles(COMPONENTS)
    .map((f) => `import ${JSON.stringify(f)}`)
    .join('\n')
  const out = await build({
    stdin: {
      contents: `${cssImports}\nimport './git-integration-contrast.entry'`,
      resolveDir: join(ROOT, 'tests/e2e'),
      sourcefile: 'contrast-entry.tsx',
      loader: 'tsx',
    },
    bundle: true,
    write: false,
    outdir: 'out',
    format: 'iife',
    jsx: 'automatic',
    platform: 'browser',
    define: { 'process.env.NODE_ENV': '"production"' },
    loader: { '.wasm': 'empty', '.svg': 'empty' },
    logLevel: 'silent',
  })
  bundleJs = out.outputFiles.find((f) => f.path.endsWith('.js'))?.text ?? ''
  bundleCss = out.outputFiles.find((f) => f.path.endsWith('.css'))?.text ?? ''
  browser = await chromium.launch()
})

test.afterAll(async () => {
  await browser?.close()
})

for (const theme of ['dark', 'light'] as const) {
  for (const surface of SURFACES) {
    test(`${surface.name} meets WCAG 2.1 AA contrast in the ${theme} theme`, async () => {
      const context = await browser.newContext({ viewport: { width: 1200, height: 700 } })
      const page = await context.newPage()
      try {
        const themeAttr = theme === 'light' ? ' data-theme="light"' : ''
        await page.setContent(
          `<!doctype html><html lang="en"${themeAttr}><head><meta charset="utf-8"><title>${surface.name}</title>` +
            `<style>${baseCss()}</style><style>${bundleCss}</style></head><body><div id="app"></div></body></html>`
        )
        await page.evaluate(
          (n) => {
            ;(window as unknown as { __SURFACE__: string }).__SURFACE__ = n
          },
          surface.name.replace('-mine', '')
        )
        await page.addScriptTag({ content: bundleJs })
        await page.waitForSelector(surface.ready)
        await surface.act?.(page)
        await page.evaluate(() => document.fonts.ready)

        await page.screenshot({ path: join(SHOTS, `${surface.name}-${theme}.png`) })

        const axe = await new AxeBuilder({ page }).withRules(['color-contrast']).analyze()
        const failures = axe.violations.flatMap((v) =>
          v.nodes.map((n) => `${n.target.join(' ')} :: ${n.any[0]?.message ?? v.help}`)
        )
        expect(failures, 'axe color-contrast violations').toEqual([])

        if (surface.selected) {
          const measured = (await page.evaluate(
            `(${MEASURE})(${JSON.stringify(surface.selected)}, ${JSON.stringify(surface.indicator ?? 'background')})`
          )) as { ratio: number } | null
          expect(measured, `${surface.selected} is rendered`).not.toBeNull()
          expect(
            measured!.ratio,
            `selected row vs its panel (1.4.11), ${surface.selected}`
          ).toBeGreaterThanOrEqual(3)
        }
      } finally {
        await context.close()
      }
    })
  }
}
