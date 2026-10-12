import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdirSync, writeFileSync, rmSync, realpathSync } from 'node:fs'
import { createRequire } from 'node:module'
import { join } from 'node:path'
import os from 'node:os'
import { requireLoader } from '../../../../../src/main/extensions/host/backend-loader'

const load = createRequire(import.meta.url)
let root: string

beforeEach(() => {
  root = realpathSync(os.tmpdir())
  root = join(root, `backend-loader-${Date.now()}-${Math.random()}`)
})

afterEach(() => rmSync(root, { recursive: true, force: true }))

function writeModule(path: string): string {
  mkdirSync(join(path, '..'), { recursive: true })
  writeFileSync(path, 'module.exports = {}\n')
  return path
}

function cached(): string[] {
  return Object.keys(load.cache).filter((path) => path.startsWith(root))
}

describe('requireLoader.forget', () => {
  it("drops the extension's modules and keeps a sibling directory's that shares its prefix", () => {
    const loader = requireLoader(load)
    const entry = writeModule(join(root, 'com.demo', 'dist', 'main.cjs'))
    const helper = writeModule(join(root, 'com.demo', 'lib', 'helper.cjs'))
    const sibling = writeModule(join(root, 'com.demo-other', 'main.cjs'))
    for (const path of [entry, helper, sibling]) loader.load(path)

    loader.forget({ entryPoint: entry, directory: join(root, 'com.demo') })

    expect(cached()).toEqual([sibling])
  })

  it('drops an entry point outside the extension directory', () => {
    const loader = requireLoader(load)
    const entry = writeModule(join(root, 'shared', 'main.cjs'))
    loader.load(entry)

    loader.forget({ entryPoint: entry, directory: join(root, 'com.demo') })

    expect(cached()).toEqual([])
  })
})
