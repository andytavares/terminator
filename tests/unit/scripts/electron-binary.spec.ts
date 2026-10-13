import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

// Electron 44 downloads its binary on its bin's first run or `install-electron`, never at
// install (https://github.com/electron/electron/blob/v44.7.0/docs/breaking-changes.md), and
// electron-vite never runs that bin: every script that starts Electron through it installs first.
const scripts: Record<string, string> = JSON.parse(
  readFileSync(join(__dirname, '../../../package.json'), 'utf8')
).scripts

const startsElectron = Object.keys(scripts).filter((name) =>
  /electron-vite (dev|preview)\b/.test(scripts[name])
)

describe('scripts that start Electron through electron-vite', () => {
  it('are the ones this check knows about', () => {
    expect(startsElectron.sort()).toEqual(['dev', 'preview'])
  })

  it.each(startsElectron)('%s installs the Electron binary first', (name) => {
    expect(scripts[`pre${name}`]).toBe('install-electron')
  })
})
