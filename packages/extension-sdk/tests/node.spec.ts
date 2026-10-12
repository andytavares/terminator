import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { writeJsonAtomic } from '@terminator/extension-sdk/node'

describe('writeJsonAtomic', () => {
  let dir: string

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'sdk-write-json-'))
  })

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  it('replaces the file with the value as indented JSON and leaves nothing beside it', async () => {
    const target = join(dir, 'state.json')
    writeFileSync(target, '{"old":true}')

    await writeJsonAtomic(target, { kept: [1, 2] })

    expect(readFileSync(target, 'utf8')).toBe(JSON.stringify({ kept: [1, 2] }, null, 2))
    expect(readdirSync(dir)).toEqual(['state.json'])
  })

  it('lets concurrent writes to one file each finish with a whole file', async () => {
    const target = join(dir, 'state.json')

    await Promise.all([writeJsonAtomic(target, { n: 1 }), writeJsonAtomic(target, { n: 2 })])

    expect([1, 2]).toContain(JSON.parse(readFileSync(target, 'utf8')).n)
    expect(readdirSync(dir)).toEqual(['state.json'])
  })
})
