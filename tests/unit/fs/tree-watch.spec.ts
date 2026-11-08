import { describe, it, expect } from 'vitest'
import * as path from 'node:path'
import { isUnwatchedPath } from '../../../src/main/fs/tree-watch'

describe('isUnwatchedPath', () => {
  it.each([
    ['/repo/node_modules', true],
    ['/repo/packages/ui/node_modules/react/index.js', true],
    ['/repo/.git/objects/ab/cdef', true],
    ['/repo/.git/index', false],
    ['/repo/.git/refs/heads/main', false],
    ['/repo/src/objects/a.ts', false],
    ['/repo/src/node_modules.ts', false],
  ])('%s → %s', (target, unwatched) => {
    expect(isUnwatchedPath(target.split('/').join(path.sep))).toBe(unwatched)
  })
})
