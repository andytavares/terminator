import { describe, it, expect, vi, afterEach } from 'vitest'
import childProcess from 'node:child_process'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)

// Since Electron 42 `npm ci` no longer fetches the binary; the first
// `require('electron')` does, from a spawned install.js. Specs reach the real
// package through externalised dependencies such as electron-store, where
// vi.mock('electron') cannot intercept, so parallel workers each started a
// download mid-run and a network hiccup failed whole suites.
describe('the electron package under the unit-test runner', () => {
  afterEach(() => {
    vi.restoreAllMocks()
    delete require.cache[require.resolve('electron')]
  })

  it('loads without starting a binary download', () => {
    const spawnSync = vi
      .spyOn(childProcess, 'spawnSync')
      .mockReturnValue({ status: 1 } as ReturnType<typeof childProcess.spawnSync>)
    delete require.cache[require.resolve('electron')]

    expect(() => require('electron')).not.toThrow()
    expect(spawnSync).not.toHaveBeenCalled()
  })
})
