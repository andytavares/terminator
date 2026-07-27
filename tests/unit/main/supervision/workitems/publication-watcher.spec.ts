import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import {
  scanPublications,
  watchPublications,
  publicationRoot,
} from '../../../../../src/main/supervision/workitems/publication-watcher.js'

let root: string

/** Polls until the predicate holds or the deadline passes. */
async function waitFor(predicate: () => boolean, timeoutMs = 5_000): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (predicate()) return
    await new Promise((resolve) => setTimeout(resolve, 25))
  }
}

beforeEach(() => (root = mkdtempSync(join(tmpdir(), 'publications-'))))
afterEach(() => rmSync(root, { recursive: true, force: true }))

function publish(producerId: string, id: string, over: Record<string, unknown> = {}): void {
  const dir = join(root, producerId)
  mkdirSync(dir, { recursive: true })
  writeFileSync(
    join(dir, `${id}.json`),
    JSON.stringify({
      contract_version: 1,
      id,
      source: 'local',
      title: `Item ${id}`,
      created_at: '2026-07-27T09:04:11Z',
      phase: 'implement',
      lanes: [{ ord: 1, repo: 'r', role: 'producer', branch: 'feat/x' }],
      ...over,
    })
  )
}

describe('scanning', () => {
  it('reads a published item', () => {
    publish('speckit-pilot', 'FLU-220')
    const snapshot = scanPublications(root)
    expect(snapshot.items).toHaveLength(1)
    expect(snapshot.items[0]).toMatchObject({ producerId: 'speckit-pilot' })
  })

  it('reads items from more than one producer at once (FR-074)', () => {
    publish('producer-a', 'A-1')
    publish('producer-b', 'B-1')
    expect(scanPublications(root).items).toHaveLength(2)
  })

  it('returns nothing for a directory that does not exist yet, which is not an error', () => {
    expect(scanPublications(join(root, 'nope'))).toEqual({
      items: [],
      unreadable: [],
      conflicts: [],
    })
  })

  it('returns nothing when no producer has published — sessions stay ad-hoc (FR-081)', () => {
    expect(scanPublications(root).items).toEqual([])
  })

  it('ignores files that are not contracts', () => {
    const dir = join(root, 'producer-a')
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, 'notes.txt'), 'ignore me')
    expect(scanPublications(root).items).toEqual([])
  })

  it('ignores loose files at the root, since producers own a subdirectory', () => {
    writeFileSync(join(root, 'stray.json'), '{}')
    expect(scanPublications(root).items).toEqual([])
  })
})

describe('per-item failure (FR-085)', () => {
  it('reports a malformed item as unreadable without affecting the others', () => {
    publish('producer-a', 'good')
    mkdirSync(join(root, 'producer-b'), { recursive: true })
    writeFileSync(join(root, 'producer-b', 'bad.json'), '{ truncated')

    const snapshot = scanPublications(root)
    expect(snapshot.items).toHaveLength(1)
    expect(snapshot.unreadable).toHaveLength(1)
    expect(snapshot.unreadable[0].reason).toContain('partial write')
  })

  it('reports an unknown contract version with a reason', () => {
    publish('producer-a', 'future', { contract_version: 99 })
    expect(scanPublications(root).unreadable[0].reason).toContain('version 99')
  })

  it('reports a schema violation naming the field', () => {
    publish('producer-a', 'bad', { phase: 'nonsense' })
    expect(scanPublications(root).unreadable[0].reason).toContain('phase')
  })
})

describe('conflicts (FR-074)', () => {
  it('reports the same id from two producers, naming both', () => {
    publish('producer-a', 'FLU-220')
    publish('producer-b', 'FLU-220')
    const snapshot = scanPublications(root)
    expect(snapshot.conflicts).toHaveLength(1)
    expect(snapshot.conflicts[0].producers.sort()).toEqual(['producer-a', 'producer-b'])
  })

  it('never silently picks one — both remain in the item list to be flagged', () => {
    publish('producer-a', 'FLU-220')
    publish('producer-b', 'FLU-220')
    expect(scanPublications(root).items).toHaveLength(2)
  })

  it('reports no conflict for distinct ids', () => {
    publish('producer-a', 'A')
    publish('producer-b', 'B')
    expect(scanPublications(root).conflicts).toEqual([])
  })
})

describe('watching', () => {
  it('creates the directory it owns rather than waiting for a producer', () => {
    const dir = join(root, 'created-by-console')
    const handle = watchPublications(dir, () => {})
    expect(scanPublications(dir)).toEqual({ items: [], unreadable: [], conflicts: [] })
    handle.close()
  })

  it('exposes an initial snapshot immediately', () => {
    publish('producer-a', 'FLU-220')
    const handle = watchPublications(root, () => {})
    expect(handle.snapshot().items).toHaveLength(1)
    handle.close()
  })

  it('re-scans when a producer publishes, without being told which file changed', async () => {
    // Polled to a deadline rather than slept on a fixed delay: a filesystem
    // event under load can arrive later than any constant you pick, and a test
    // that depends on one is a CI flake waiting to happen.
    const handle = watchPublications(root, () => {})
    try {
      publish('producer-a', 'FLU-220')
      await waitFor(() => handle.snapshot().items.length === 1)
      expect(handle.snapshot().items).toHaveLength(1)
    } finally {
      handle.close()
    }
  })

  it('is safe to close twice', () => {
    const handle = watchPublications(root, () => {})
    handle.close()
    expect(() => handle.close()).not.toThrow()
  })
})

describe('publicationRoot', () => {
  it('is inside the application user data, not inside any producer', () => {
    const path = publicationRoot('/userdata')
    expect(path).toBe('/userdata/supervision/workitems')
  })
})
