import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { seedOrder, houseDocsIn, newOrderId } from '../../src/forge/intake-source.js'
import type { SeedDeps } from '../../src/forge/intake-source.js'

// Scout runs before the operator is asked anything (FR-002). By the time a
// question could be put to them, the repository has already been read, the
// toolchain probed and whatever the project says about itself picked up — so a
// question that the code answers is a defect in intake rather than a question.

let repo: string

function write(rel: string, body: string): void {
  const full = path.join(repo, rel)
  fs.mkdirSync(path.dirname(full), { recursive: true })
  fs.writeFileSync(full, body)
}

function deps(over: Partial<SeedDeps> = {}): SeedDeps {
  return {
    now: () => '2026-09-06T10:00:00.000Z',
    newId: () => 'WO-0906-abc',
    readIssue: vi.fn(async () => null),
    existingOrderFor: () => null,
    ...over,
  }
}

beforeEach(() => {
  repo = fs.mkdtempSync(path.join(os.tmpdir(), 'foundry-intake-'))
  write('package.json', JSON.stringify({ scripts: { test: 'vitest run', lint: 'eslint .' } }))
})

afterEach(() => {
  fs.rmSync(repo, { recursive: true, force: true })
})

describe('seedOrder from a typed idea', () => {
  it('produces a complete draft without asking anything first', async () => {
    const r = await seedOrder(
      { kind: 'typed', text: 'the greeting should say hello, not hi', repoPaths: [repo] },
      deps()
    )
    expect('order' in r).toBe(true)
    if (!('order' in r)) return
    expect(r.order.status).toBe('draft')
    expect(r.order.title).toContain('hello')
    expect(r.order.intent.problem).toContain('hello')
    expect(r.order.openQuestions).toEqual([])
  })

  it('fills the toolchain from the repository before anything else happens', async () => {
    const r = await seedOrder({ kind: 'typed', text: 'x', repoPaths: [repo] }, deps())
    if (!('order' in r)) throw new Error('expected an order')
    expect(r.order.context.toolchain.test).toEqual({
      command: 'npm run test',
      source: 'package.json',
    })
    expect(r.order.context.toolchain.coverage).toBeNull()
  })

  it('records the checks this repository cannot run, so the gap is known up front', async () => {
    const r = await seedOrder({ kind: 'typed', text: 'x', repoPaths: [repo] }, deps())
    if (!('order' in r)) throw new Error('expected an order')
    expect(r.unavailableChecks).toEqual(expect.arrayContaining(['coverage', 'e2e']))
  })

  it('picks up whatever the project says about itself', async () => {
    write('CLAUDE.md', '# rules')
    write('.specify/memory/constitution.md', '# constitution')
    const r = await seedOrder({ kind: 'typed', text: 'x', repoPaths: [repo] }, deps())
    if (!('order' in r)) throw new Error('expected an order')
    expect(r.order.context.houseDocs).toEqual(
      expect.arrayContaining(['CLAUDE.md', '.specify/memory/constitution.md'])
    )
  })

  it('completes in a repository that says nothing about itself', async () => {
    const bare = fs.mkdtempSync(path.join(os.tmpdir(), 'foundry-bare-'))
    const r = await seedOrder({ kind: 'typed', text: 'x', repoPaths: [bare] }, deps())
    fs.rmSync(bare, { recursive: true, force: true })
    if (!('order' in r)) throw new Error('expected an order')
    expect(r.order.context.houseDocs).toEqual([])
    expect(r.unavailableChecks).toHaveLength(6)
  })

  it('opens one lane per repository', async () => {
    const second = fs.mkdtempSync(path.join(os.tmpdir(), 'foundry-second-'))
    const r = await seedOrder({ kind: 'typed', text: 'x', repoPaths: [repo, second] }, deps())
    fs.rmSync(second, { recursive: true, force: true })
    if (!('order' in r)) throw new Error('expected an order')
    expect(r.order.plan.lanes).toHaveLength(2)
  })

  it('never reads an issue when the idea was typed', async () => {
    const readIssue = vi.fn(async () => null)
    await seedOrder({ kind: 'typed', text: 'x', repoPaths: [repo] }, deps({ readIssue }))
    expect(readIssue).not.toHaveBeenCalled()
  })
})

describe('seedOrder from a tracker issue', () => {
  const issue = {
    key: 'TAV-42',
    title: 'Terminal clips the last glyph of every row',
    description: 'The row div overflow slices the final glyph.',
    url: 'https://linear.app/x/TAV-42',
    branchName: 'andrew/tav-42-row-clipping',
  }

  it('seeds title, intent and provenance from the issue', async () => {
    const r = await seedOrder(
      { kind: 'tracker', tracker: 'linear', key: 'TAV-42', repoPaths: [repo] },
      deps({ readIssue: vi.fn(async () => issue) })
    )
    if (!('order' in r)) throw new Error('expected an order')
    expect(r.order.title).toBe(issue.title)
    expect(r.order.intent.problem).toContain('overflow')
    expect(r.order.source).toEqual({
      kind: 'tracker',
      tracker: 'linear',
      key: 'TAV-42',
      url: issue.url,
    })
  })

  it('uses the branch name the tracker suggests rather than inventing one', async () => {
    const r = await seedOrder(
      { kind: 'tracker', tracker: 'linear', key: 'TAV-42', repoPaths: [repo] },
      deps({ readIssue: vi.fn(async () => issue) })
    )
    if (!('order' in r)) throw new Error('expected an order')
    expect(r.order.plan.lanes[0].branch).toBe('andrew/tav-42-row-clipping')
  })

  it('offers the existing order when the same issue is seeded twice', async () => {
    const r = await seedOrder(
      { kind: 'tracker', tracker: 'linear', key: 'TAV-42', repoPaths: [repo] },
      deps({ existingOrderFor: () => ({ id: 'WO-0905-zzz', title: 'already seeded' }) })
    )
    expect('existing' in r).toBe(true)
    if ('existing' in r) expect(r.existing.id).toBe('WO-0905-zzz')
  })

  it('reports an issue it cannot read rather than seeding an empty order', async () => {
    const r = await seedOrder(
      { kind: 'tracker', tracker: 'linear', key: 'TAV-99', repoPaths: [repo] },
      deps({ readIssue: vi.fn(async () => null) })
    )
    expect('error' in r).toBe(true)
    if ('error' in r) expect(r.error).toContain('TAV-99')
  })

  it('seeds an issue with nothing but a title', async () => {
    const r = await seedOrder(
      { kind: 'tracker', tracker: 'linear', key: 'TAV-7', repoPaths: [repo] },
      deps({
        readIssue: vi.fn(async () => ({
          key: 'TAV-7',
          title: 'Just a title',
          description: '',
          url: 'u',
          branchName: null,
        })),
      })
    )
    if (!('order' in r)) throw new Error('expected an order')
    expect(r.order.title).toBe('Just a title')
    expect(r.order.intent.problem).toBe('Just a title')
  })
})

describe('seedOrder validation', () => {
  it('refuses to seed with no repository', async () => {
    const r = await seedOrder({ kind: 'typed', text: 'x', repoPaths: [] }, deps())
    expect('error' in r).toBe(true)
  })

  it('refuses to seed a typed idea with no words in it', async () => {
    const r = await seedOrder({ kind: 'typed', text: '   ', repoPaths: [repo] }, deps())
    expect('error' in r).toBe(true)
  })
})

describe('houseDocsIn', () => {
  it('finds only what is actually there', () => {
    write('AGENTS.md', 'x')
    expect(houseDocsIn(repo)).toEqual(['AGENTS.md'])
  })

  it('returns nothing for a repository that carries none', () => {
    expect(houseDocsIn(repo)).toEqual([])
  })
})

describe('newOrderId', () => {
  it('is shaped so it sorts by date and cannot collide by accident', () => {
    const id = newOrderId(new Date('2026-09-13T00:00:00Z'), () => 0.5)
    expect(id).toMatch(/^WO-0913-[0-9a-f]{3}$/)
  })
})
