import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

// Electron 44 no longer downloads its binary in a postinstall script; it does so the
// first time its own bin runs, or when `install-electron` is called
// (https://github.com/electron/electron/blob/v44.7.0/docs/breaking-changes.md).
// electron-vite reads node_modules/electron/path.txt itself and never runs that bin,
// so every script that starts Electron through electron-vite must install it first.
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
