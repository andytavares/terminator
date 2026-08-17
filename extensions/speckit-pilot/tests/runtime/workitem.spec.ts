import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { readCardLanes } from '../../src/runtime/workitem.js'

// The contract between the pipeline and the console is a file an agent wrote,
// so every case here is about what happens when it is not what was promised.

let dir: string

function write(content: unknown): void {
  writeFileSync(
    join(dir, 'workitem.json'),
    typeof content === 'string' ? content : JSON.stringify(content)
  )
}

const lane = (over: Record<string, unknown> = {}) => ({
  ord: 1,
  repo: 'fluent',
  branch: 'feat/session-ulid',
  blocks: [2],
  blocked_by: [],
  ...over,
})

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'workitem-'))
})

afterEach(() => rmSync(dir, { recursive: true, force: true, maxRetries: 5 }))

describe('a card that declares lanes', () => {
  it('reads them', () => {
    write({ id: 'FLU-220', lanes: [lane()] })
    expect(readCardLanes(dir)?.lanes[0]).toMatchObject({ ord: 1, repo: 'fluent' })
  })

  it('keeps the shared contract files, which are what make ordering matter', () => {
    write({ id: 'FLU-220', lanes: [lane()], contract: { shared_files: ['proto/session.proto'] } })
    expect(readCardLanes(dir)?.contract?.shared_files).toEqual(['proto/session.proto'])
  })

  it('normalises absent dependency lists to empty ones', () => {
    // An absent array and an empty one mean the same thing, and every rule
    // downstream reads them without guarding.
    write({ lanes: [{ ord: 1, repo: 'fluent', branch: 'feat/x' }] })
    expect(readCardLanes(dir)?.lanes[0]).toMatchObject({ blocks: [], blocked_by: [] })
  })

  it('falls back to the directory name when the item has no id', () => {
    write({ lanes: [lane()] })
    expect(readCardLanes(dir)?.id).toBe(dir.split('/').pop())
  })

  it('keeps a role it recognises and drops one it does not', () => {
    write({ lanes: [lane({ role: 'producer' }), lane({ ord: 2, role: 'sidekick' })] })
    const lanes = readCardLanes(dir)?.lanes ?? []
    expect(lanes[0].role).toBe('producer')
    expect(lanes[1].role).toBeUndefined()
  })
})

describe('a card that does not', () => {
  it('reports nothing when there is no file — that is a one-repository card', () => {
    expect(readCardLanes(dir)).toBeNull()
  })

  it('reports nothing rather than throwing on a file that is not JSON', () => {
    write('half a file, written while the agent was interrupted')
    expect(readCardLanes(dir)).toBeNull()
  })

  it('reports nothing when the lane list is empty', () => {
    // "One repository" and "a work item with no lanes" are different things,
    // and only the second would be worth showing.
    write({ id: 'FLU-220', lanes: [] })
    expect(readCardLanes(dir)).toBeNull()
  })

  it('drops a lane that cannot be ordered, named or checked out', () => {
    // A half-lane in the strip reads as a repository you forgot to start.
    write({ lanes: [lane(), { ord: 2, repo: 'cli-flow' }] })
    expect(readCardLanes(dir)?.lanes).toHaveLength(1)
  })

  it('ignores dependency entries that are not lane numbers', () => {
    write({ lanes: [lane({ blocked_by: ['two', 3] })] })
    expect(readCardLanes(dir)?.lanes[0].blocked_by).toEqual([3])
  })

  it('tolerates a contract that is not an object', () => {
    write({ lanes: [lane()], contract: 'proto/session.proto' })
    expect(readCardLanes(dir)?.contract?.shared_files).toEqual([])
  })
})
