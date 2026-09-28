import { describe, it, expect } from 'vitest'
import { execFileSync } from 'node:child_process'
import { resolve } from 'node:path'

// `node_modules/` in .gitignore matches directories only, so a symlink named
// node_modules was committed (d385af3e). In the main checkout it pointed at
// itself, npm could not find vite through it, and the Foundry renderer build
// failed on every `npm run build:extensions` — the app kept serving a bundle
// from before the fixes that followed.
describe('the extension build inputs', () => {
  it('track nothing named node_modules', () => {
    const root = resolve(__dirname, '../../..')
    const tracked = execFileSync('git', ['ls-files'], { cwd: root, encoding: 'utf8' })
      .split('\n')
      .filter((path) => path.split('/').includes('node_modules'))
    expect(tracked).toEqual([])
  })
})
