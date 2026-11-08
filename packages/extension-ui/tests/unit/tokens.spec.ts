import { describe, it, expect } from 'vitest'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { EXTENSION_BASE_CSS } from '../../src/extension-base-css'
import { readBeside } from '../../../test-support/src/files'

const TOKENS = readBeside(import.meta.url, '../../../../packages/extension-ui/src/tokens.css')
const CORE_DIRECTORY = fileURLToPath(new URL('../../../core-renderer/src', import.meta.url))
const REPO_ROOT = fileURLToPath(new URL('../../../../', import.meta.url))
// A raw size in `font-size`, or the size in the `font` shorthand (after any style and weight words).
const RAW_FONT_SIZE = /(?<![-\w])font(-size)?:\s*(?:(?:[a-z]+|\d{3})\s+)*[0-9.]+(px|rem)\b/g
const STYLE_ROOTS = [
  'packages/core-renderer/src',
  'packages/core-renderer-remote/src',
  'packages/extension-ui/src',
  'extensions',
]

/** Every stylesheet of the core renderer, as one text. */
const CORE_STYLES = readdirSync(CORE_DIRECTORY, { recursive: true, encoding: 'utf8' })
  .filter((file) => file.endsWith('.css'))
  .map((file) => readFileSync(join(CORE_DIRECTORY, file), 'utf8'))
  .join('\n')

function definedTokens(css: string): Set<string> {
  return new Set([...css.matchAll(/^\s*(--tm-[a-z0-9-]+):/gm)].map((match) => match[1]))
}

describe('tokens.css', () => {
  it('is the text every extension document is injected with', () => {
    expect(EXTENSION_BASE_CSS).toContain(TOKENS)
  })

  it('defines every token the core uses, so no core rule resolves to nothing', () => {
    const defined = definedTokens(TOKENS)
    const referenced = [...CORE_STYLES.matchAll(/var\((--tm-[a-z0-9-]+)[,)]/g)].map((m) => m[1])
    expect(referenced.length).toBeGreaterThan(400)
    expect([...new Set(referenced.filter((name) => !defined.has(name)))]).toEqual([])
  })

  it('leaves the core without a second name for a token', () => {
    const secondNames = CORE_STYLES.split('\n').filter((line) =>
      /^\s*--(bg|text|border|accent|on-accent|danger|success|warning|space|radius|font)[a-z0-9-]*:/.test(
        line
      )
    )
    expect(secondNames).toEqual([])
  })

  it('replaces the dark values with light ones for the surfaces and text', () => {
    const light = TOKENS.slice(TOKENS.indexOf("[data-theme='light'] {"))
    for (const name of ['--tm-bg-base', '--tm-text-primary', '--tm-border', '--tm-accent-text']) {
      expect(light).toContain(`${name}:`)
    }
  })
})

describe('the type scale', () => {
  it('sizes every font from the type scale, in the core and every extension', () => {
    const stylesheets = STYLE_ROOTS.flatMap((root) =>
      readdirSync(join(REPO_ROOT, root), { recursive: true, encoding: 'utf8' })
        .filter(
          (file) => file.endsWith('.css') && !/(^|\/)(node_modules|dist|coverage)\//.test(file)
        )
        .map((file) => join(root, file))
    )
    expect(stylesheets.length).toBeGreaterThan(90)
    const rawSizes = stylesheets.flatMap((file) =>
      [...readFileSync(join(REPO_ROOT, file), 'utf8').matchAll(RAW_FONT_SIZE)].map(
        (match) => `${file}: ${match[0]}`
      )
    )
    expect(rawSizes).toEqual([])
  })
})
