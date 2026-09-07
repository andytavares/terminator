import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import {
  acceptProposal,
  declineProposal,
  declinedProposals,
  removeRule,
  rulesFor,
} from '../../src/verify/rules.js'
import { propose } from '../../src/ledger/curator.js'
import { resolveRule } from '../../src/recipe/resolve.js'
import type { ResolveSources } from '../../src/recipe/resolve.js'
import type { LedgerEntry } from '../../src/ledger/append.js'

// A rule the operator accepted is in force from the next run, carries the
// entries it was derived from, and can be taken away again.
//
// Written to the data root, which is rung one of name resolution — so there is
// nothing else to wire, and nothing that could be wired wrong.

let root: string
let repo: string
const builtInDir = path.resolve(__dirname, '..', '..')

function sources(): ResolveSources {
  return { dataRoot: root, repoPaths: [repo], builtInDir }
}

function entry(over: Partial<LedgerEntry> = {}): LedgerEntry {
  return {
    at: '2026-09-06T10:00:00.000Z',
    orderId: 'WO-1',
    actor: 'operator',
    action: 'review.rejected',
    subject: 'U-1',
    reason: 'the timeout is hardcoded rather than read from configuration',
    evidence: [],
    ...over,
  }
}

function proposal() {
  const entries = [1, 2, 3].map((n) =>
    entry({ at: `2026-09-0${n}T10:00:00.000Z`, subject: `U-${n}` })
  )
  const [first] = propose({ entries })
  return first
}

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'fdry-rules-'))
  repo = fs.mkdtempSync(path.join(os.tmpdir(), 'fdry-rules-repo-'))
})

afterEach(() => {
  for (const dir of [root, repo]) {
    fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 20 })
  }
})

describe('accepting a proposal', () => {
  it('writes a rule the ordinary parser can read', async () => {
    const p = proposal()
    await acceptProposal(root, p)
    const resolved = resolveRule(p.id, sources())
    expect(resolved.ok).toBe(true)
  })

  it('puts it on the data-root rung, so it applies to every repository', async () => {
    const p = proposal()
    await acceptProposal(root, p)
    const resolved = resolveRule(p.id, sources())
    expect(resolved.ok && resolved.resolved.rung).toBe('data-root')
  })

  it('records what it was derived from, on the rule itself', async () => {
    const p = proposal()
    await acceptProposal(root, p)
    const resolved = resolveRule(p.id, sources())
    if (!resolved.ok) throw new Error(resolved.reason)
    expect(resolved.resolved.value.origin).toMatch(/^curator:/)
    expect(resolved.resolved.value.origin).toContain('2026-09-01T10:00:00.000Z/U-1')
  })

  it('keeps the rung the proposal chose', async () => {
    const p = proposal()
    await acceptProposal(root, p)
    const resolved = resolveRule(p.id, sources())
    expect(resolved.ok && resolved.resolved.value.rung).toBe(p.rung)
  })

  it('applies to later work, alongside the rules that ship with the tool', async () => {
    const p = proposal()
    await acceptProposal(root, p)
    const loaded = rulesFor(sources(), { repoPaths: [repo], houseDocs: [] })
    expect(loaded.rules.map((r) => r.id)).toContain(p.id)
    expect(loaded.rules.map((r) => r.id)).toContain('no-stubs')
    expect(loaded.problems).toEqual([])
  })

  it('names the file it wrote, so the operator can go and read it', async () => {
    const file = await acceptProposal(root, proposal())
    expect(file.startsWith(root)).toBe(true)
    expect(fs.existsSync(file)).toBe(true)
  })
})

describe('declining a proposal', () => {
  it('is remembered, so it is never offered again', async () => {
    const p = proposal()
    await declineProposal(root, p.id, 'we do that on purpose')
    expect(await declinedProposals(root)).toEqual([p.id])
  })

  it('keeps the reason, not just the fact', async () => {
    await declineProposal(root, 'curator-x', 'we do that on purpose')
    const raw = fs.readFileSync(path.join(root, 'rules', 'declined.json'), 'utf8')
    expect(raw).toContain('we do that on purpose')
  })

  it('accumulates rather than replacing', async () => {
    await declineProposal(root, 'curator-a', 'no')
    await declineProposal(root, 'curator-b', 'also no')
    expect(await declinedProposals(root)).toEqual(['curator-a', 'curator-b'])
  })

  it('adds no rule', async () => {
    await declineProposal(root, 'curator-a', 'no')
    expect(resolveRule('curator-a', sources()).ok).toBe(false)
  })

  it('stops the curator proposing it again', async () => {
    const p = proposal()
    await declineProposal(root, p.id, 'no')
    const entries = [1, 2, 3].map((n) =>
      entry({ at: `2026-09-0${n}T10:00:00.000Z`, subject: `U-${n}` })
    )
    expect(propose({ entries, rejectedIds: await declinedProposals(root) })).toEqual([])
  })

  it('reads an unreadable record as nothing declined', async () => {
    fs.mkdirSync(path.join(root, 'rules'), { recursive: true })
    fs.writeFileSync(path.join(root, 'rules', 'declined.json'), '{{{')
    expect(await declinedProposals(root)).toEqual([])
  })

  it('ignores a record that is valid JSON but not an object', async () => {
    fs.mkdirSync(path.join(root, 'rules'), { recursive: true })
    fs.writeFileSync(path.join(root, 'rules', 'declined.json'), '["nope"]')
    expect(await declinedProposals(root)).toEqual([])
  })
})

describe('removing an accepted rule', () => {
  it('takes it out of force', async () => {
    const p = proposal()
    await acceptProposal(root, p)
    expect(await removeRule(root, p.id, 'it fired on everything')).toBe(true)
    expect(
      rulesFor(sources(), { repoPaths: [repo], houseDocs: [] }).rules.map((r) => r.id)
    ).not.toContain(p.id)
  })

  it('records why, and never proposes it again', async () => {
    const p = proposal()
    await acceptProposal(root, p)
    await removeRule(root, p.id, 'it fired on everything')
    expect(await declinedProposals(root)).toContain(p.id)
    const raw = fs.readFileSync(path.join(root, 'rules', 'declined.json'), 'utf8')
    expect(raw).toContain('it fired on everything')
  })

  it('reports a rule that was not there rather than pretending it removed one', async () => {
    expect(await removeRule(root, 'curator-nothing', 'x')).toBe(false)
  })

  it('leaves the rules that ship with the tool alone', async () => {
    await removeRule(root, 'no-stubs', 'x')
    expect(
      rulesFor(sources(), { repoPaths: [repo], houseDocs: [] }).rules.map((r) => r.id)
    ).toContain('no-stubs')
  })
})
