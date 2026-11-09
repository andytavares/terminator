import { createRequire } from 'node:module'
import { describe, expect, it } from 'vitest'

const require = createRequire(import.meta.url)
const { extraResources } = require('../../../electron-builder.cjs') as {
  extraResources?: Array<{ from: string; to: string }>
}

describe('termctl in the packaged app', () => {
  // Main points the launcher at process.resourcesPath/termctl/termctl.mjs.
  it('ships the built termctl.mjs at Resources/termctl/termctl.mjs', () => {
    expect(extraResources).toContainEqual({
      from: 'apps/termctl/dist/termctl.mjs',
      to: 'termctl/termctl.mjs',
    })
  })
})
