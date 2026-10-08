import { describe, it, expect } from 'vitest'
import { brokenInstall } from '../../src/verify/broken-install.js'

// Both lines are verbatim from WO-1008-6fe's final-check logs: one from the
// base checkout, one from the order's own checkout. Neither is the code's fault.

describe('brokenInstall', () => {
  it('names a package the installed dependencies do not have', () => {
    const log = `Error: Cannot find package '@axe-core/playwright' imported from /w/tests/e2e/git-integration-contrast.spec.ts`
    expect(brokenInstall(log)).toBe('the package @axe-core/playwright is not installed')
  })

  it('names a bare module CommonJS cannot resolve', () => {
    const log = "Error: Cannot find module 'rehype-raw'\nRequire stack:\n- /w/src/a.js"
    expect(brokenInstall(log)).toBe('the package rehype-raw is not installed')
  })

  it('names a binary that cannot load its own library', () => {
    const log = `[pid=74576][err] dyld[74576]: Library not loaded: @rpath/Electron Framework.framework/Electron Framework
  Reason: tried: '/w/node_modules/electron/dist/Electron.app/Contents/Frameworks/Electron Framework.framework/Electron Framework' (segment '__TEXT' content (fileOffset: 0x0 -> 0xA99C000) extends beyond end of file (length: 0x2C92A21))`
    expect(brokenInstall(log)).toBe(
      'Electron Framework could not be loaded, so the installed copy is incomplete'
    )
  })

  it('leaves a missing file of the project itself to the code', () => {
    expect(brokenInstall("Error: Cannot find module './render.js'")).toBeNull()
    expect(brokenInstall("Error: Cannot find module '/w/src/render.js'")).toBeNull()
  })

  it('leaves an ordinary test failure alone', () => {
    expect(brokenInstall('1 failed\n  expect(received).toBe(expected)')).toBeNull()
    expect(brokenInstall('')).toBeNull()
  })
})
