import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { EXTENSION_BASE_CSS } from '../../../../packages/extension-ui/src/extension-base-css'

const read = (path: string) => readFileSync(fileURLToPath(new URL(path, import.meta.url)), 'utf8')
const TOKENS = read('../../../../packages/extension-ui/src/tokens.css')
const CORE_STYLES = read('../../../../src/renderer/styles.css')

function definedTokens(css: string): Set<string> {
  return new Set([...css.matchAll(/^\s*(--tm-[a-z0-9-]+):/gm)].map((match) => match[1]))
}

describe('tokens.css', () => {
  it('is the text every extension document is injected with', () => {
    expect(EXTENSION_BASE_CSS).toContain(TOKENS)
  })

  it('defines every token the core aliases, so no core variable resolves to nothing', () => {
    const defined = definedTokens(TOKENS)
    const referenced = [...CORE_STYLES.matchAll(/var\((--tm-[a-z0-9-]+)\)/g)].map((m) => m[1])
    expect(referenced.length).toBeGreaterThan(40)
    expect(referenced.filter((name) => !defined.has(name))).toEqual([])
  })

  it('leaves the core stylesheet without a colour or length of its own for a token', () => {
    const aliasBlock = CORE_STYLES.slice(CORE_STYLES.indexOf(':root {'))
    const tokenAliases = aliasBlock
      .split('\n')
      .filter((line) =>
        /^\s*--(bg|text|border|accent|on-accent|danger|success|space|radius)/.test(line)
      )
    expect(tokenAliases.length).toBeGreaterThan(20)
    for (const line of tokenAliases) expect(line).toMatch(/:\s*var\(--tm-[a-z0-9-]+\);/)
  })

  it('replaces the dark values with light ones for the surfaces and text', () => {
    const light = TOKENS.slice(TOKENS.indexOf("[data-theme='light'] {"))
    for (const name of ['--tm-bg-base', '--tm-text-primary', '--tm-border', '--tm-accent-text']) {
      expect(light).toContain(`${name}:`)
    }
  })
})
