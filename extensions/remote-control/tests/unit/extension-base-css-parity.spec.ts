/**
 * Enforces that the EXTENSION_BASE_CSS constant in remote-server.ts stays in sync
 * with the canonical copy in src/main/extensions/extension-view-host.ts.
 * A direct import of extension-view-host.ts is impossible from the extension bundle
 * (circular Electron dep), so this test reads both source files and compares the
 * extracted CSS strings.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { resolve } from 'path'

function extractCSSConstant(srcPath: string): string {
  const src = readFileSync(srcPath, 'utf8')
  const match = src.match(/(?:export )?const EXTENSION_BASE_CSS\s*=\s*`([\s\S]*?)`/)
  if (!match) throw new Error(`EXTENSION_BASE_CSS not found in ${srcPath}`)
  return match[1].trim()
}

describe('EXTENSION_BASE_CSS parity', () => {
  it('remote-server.ts copy matches extension-view-host.ts canonical source', () => {
    const root = resolve(__dirname, '../../../..')
    const canonical = extractCSSConstant(
      resolve(root, 'src/main/extensions/extension-view-host.ts')
    )
    const copy = extractCSSConstant(
      resolve(root, 'extensions/remote-control/src/server/remote-server.ts')
    )
    expect(copy).toBe(canonical)
  })
})
