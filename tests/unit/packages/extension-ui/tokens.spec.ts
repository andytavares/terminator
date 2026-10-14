import { describe, it, expect } from 'vitest'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { EXTENSION_BASE_CSS } from '../../../../packages/extension-ui/src/extension-base-css'
import { readBeside } from '../../../support/files'

const TOKENS = readBeside(import.meta.url, '../../../../packages/extension-ui/src/tokens.css')
const CORE_DIRECTORY = fileURLToPath(new URL('../../../../src/renderer', import.meta.url))

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
