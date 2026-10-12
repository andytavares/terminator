import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { moveFromUserData, writeJsonAtomic } from '@terminator/extension-sdk/node'

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

describe('moveFromUserData', () => {
  let userData: string
  let globalStorage: string
  const warn = vi.fn()
  const api = () => ({ paths: { app: '/app', globalStorage }, log: { warn } })

  beforeEach(() => {
    warn.mockClear()
    userData = mkdtempSync(join(tmpdir(), 'sdk-move-legacy-'))
    globalStorage = join(userData, 'extensions', 'com.example.tool')
  })

  afterEach(() => {
    rmSync(userData, { recursive: true, force: true })
  })

  it('moves a folder and a file from userData into globalStorage, creating it', () => {
    mkdirSync(join(userData, 'tool', 'orders'), { recursive: true })
    writeFileSync(join(userData, 'tool', 'orders', 'ledger.jsonl'), '{"n":1}\n')
    writeFileSync(join(userData, 'tool-state.json'), '{"open":true}')

    const outcomes = moveFromUserData(api(), [
      { from: 'tool', to: 'records' },
      { from: 'tool-state.json', to: 'state.json' },
    ])

    expect(outcomes).toEqual(['moved', 'moved'])
    expect(readFileSync(join(globalStorage, 'records', 'orders', 'ledger.jsonl'), 'utf8')).toBe(
      '{"n":1}\n'
    )
    expect(readFileSync(join(globalStorage, 'state.json'), 'utf8')).toBe('{"open":true}')
    expect(existsSync(join(userData, 'tool'))).toBe(false)
    expect(existsSync(join(userData, 'tool-state.json'))).toBe(false)
    expect(warn).not.toHaveBeenCalled()
  })

  it('moves nothing on a later activation, once the data is in globalStorage', () => {
    mkdirSync(join(userData, 'tool'))
    moveFromUserData(api(), [{ from: 'tool', to: 'records' }])

    expect(moveFromUserData(api(), [{ from: 'tool', to: 'records' }])).toEqual(['nothing-to-move'])
    expect(existsSync(join(globalStorage, 'records'))).toBe(true)
  })

  it('leaves both copies untouched when the new location already exists', () => {
    mkdirSync(join(userData, 'tool'))
    writeFileSync(join(userData, 'tool', 'ledger.jsonl'), 'old')
    mkdirSync(join(globalStorage, 'records'), { recursive: true })
    writeFileSync(join(globalStorage, 'records', 'ledger.jsonl'), 'new')

    expect(moveFromUserData(api(), [{ from: 'tool', to: 'records' }])).toEqual(['kept-both'])
    expect(readFileSync(join(userData, 'tool', 'ledger.jsonl'), 'utf8')).toBe('old')
    expect(readFileSync(join(globalStorage, 'records', 'ledger.jsonl'), 'utf8')).toBe('new')
    expect(warn).toHaveBeenCalledWith(expect.stringContaining(join(userData, 'tool')))
  })

  it('creates nothing when there is nothing to move', () => {
    expect(moveFromUserData(api(), [{ from: 'tool', to: 'records' }])).toEqual(['nothing-to-move'])
    expect(existsSync(globalStorage)).toBe(false)
  })
})
