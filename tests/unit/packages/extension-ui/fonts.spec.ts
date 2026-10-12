import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

// Principle XIII: fonts ship with the app. Extension views are separate
// documents that inherit nothing from the core renderer, so each view's entry
// has to bundle the faces itself, or it draws in whatever the system has.

const ROOT = fileURLToPath(new URL('../../../../', import.meta.url))
const FONTS_MODULE = '@terminator/extension-ui/fonts'

function viewEntries(): string[] {
  return readdirSync(path.join(ROOT, 'extensions'))
    .map((name) => path.join(ROOT, 'extensions', name))
    .filter((dir) => existsSync(path.join(dir, 'index.html')))
    .map((dir) => {
      const html = readFileSync(path.join(dir, 'index.html'), 'utf8')
      const src = /<script type="module" src="\/([^"]+)"/.exec(html)?.[1]
      return path.join(dir, src ?? 'missing-entry')
    })
}

describe('bundled fonts', () => {
  it('finds every extension view entry', () => {
    expect(viewEntries().length).toBeGreaterThanOrEqual(5)
  })

  it.each(viewEntries().map((entry) => [path.relative(ROOT, entry)]))(
    '%s loads the bundled faces',
    (entry) => {
      expect(readFileSync(path.join(ROOT, entry), 'utf8')).toContain(`import '${FONTS_MODULE}'`)
    }
  )

  it('is what the core renderer loads too', () => {
    const core = readFileSync(path.join(ROOT, 'src/renderer/index.tsx'), 'utf8')
    expect(core).toContain(`import '${FONTS_MODULE}'`)
    expect(core).not.toMatch(/@fontsource\//)
  })

  it('bundles both families the tokens name, from local files', () => {
    const fonts = readFileSync(path.join(ROOT, 'packages/extension-ui/src/fonts.ts'), 'utf8')
    expect(fonts).toMatch(/@fontsource\/ibm-plex-sans\/\d+\.css/)
    expect(fonts).toMatch(/@fontsource\/ibm-plex-mono\/\d+\.css/)
    expect(fonts).not.toMatch(/https?:/)
  })
})
