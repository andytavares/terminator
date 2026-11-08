import { describe, it, expect } from 'vitest'
import { execFileSync } from 'node:child_process'
import { resolve } from 'node:path'

// `node_modules/` in .gitignore matches directories only, so a node_modules symlink was committed
// (d385af3e). It pointed at itself, npm could not find vite through it, and every
// `npm run build:extensions` failed while the app kept serving an old bundle.
describe('the extension build inputs', () => {
  it('track nothing named node_modules', () => {
    const root = resolve(__dirname, '../../..')
    const tracked = execFileSync('git', ['ls-files'], { cwd: root, encoding: 'utf8' })
      .split('\n')
      .filter((path) => path.split('/').includes('node_modules'))
    expect(tracked).toEqual([])
  })
})
