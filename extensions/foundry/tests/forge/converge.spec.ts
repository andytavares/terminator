import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { fileURLToPath } from 'node:url'
import { convergeBrief, readProposal, NoArchitectError } from '../../src/forge/converge.js'
import { draftOrder, RISK_TRIGGERS } from '../../src/order/schema.js'
import type { WorkOrder } from '../../src/order/schema.js'
import { orderDir } from '../../src/data-root.js'

// Converging an order.
//
// Seeding produces a draft with a problem statement and what the repository
// says about itself. This is the half that turns that into criteria and a
// plan — and without it no order can ever pass the compile gate, so nothing
// can ever be handed off.

const builtInDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')

let root: string
let repo: string

function sources(
  over: Partial<{ dataRoot: string; repoPaths: string[]; builtInDir: string }> = {}
) {
  return { dataRoot: root, repoPaths: [repo], builtInDir, ...over }
}

function order(over: Partial<WorkOrder> = {}): WorkOrder {
  const base = draftOrder({
    id: 'WO-1',
    title: 'Refuse an expired refresh token',
    source: { kind: 'typed', tracker: null, key: null, url: null },
    repoPaths: [repo],
    now: '2026-09-06T10:00:00.000Z',
  })
  return { ...base, intent: { ...base.intent, problem: 'expired tokens are accepted' }, ...over }
}

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'fdry-converge-'))
  repo = fs.mkdtempSync(path.join(os.tmpdir(), 'fdry-converge-repo-'))
})

afterEach(() => {
  for (const d of [root, repo]) {
    fs.rmSync(d, { recursive: true, force: true, maxRetries: 5, retryDelay: 20 })
  }
})

describe('what the architect is told', () => {
  it("leads with the architect's own prompt and the order", () => {
    const plan = convergeBrief({ order: order(), root, sources: sources(), rules: [] })
    expect(plan.prompt).toContain('Turn intent and context into criteria and a plan')
    expect(plan.prompt).toContain('expired tokens are accepted')
  })

  it('names the file to write and says nothing else counts', () => {
    const plan = convergeBrief({ order: order(), root, sources: sources(), rules: [] })
    expect(plan.proposalPath).toBe(path.join(orderDir(root, 'WO-1'), 'proposal.json'))
    expect(plan.prompt).toContain(plan.proposalPath)
    expect(plan.prompt).toContain('Nothing else you do counts')
  })

  // Measured on WO-0907-3c1: the contract spelled out the legal values for
  // `risk.grade` and not for `risk.triggers`, so the architect wrote a
  // sentence into a closed enum and nine minutes of deep-tier work was refused
  // outright. An enum an agent is never shown is an enum it writes prose into.
  it('names every value a risk trigger may take', () => {
    const plan = convergeBrief({ order: order(), root, sources: sources(), rules: [] })
    for (const trigger of RISK_TRIGGERS) expect(plan.prompt).toContain(trigger)
  })

  it('says a trigger is a label rather than a sentence', () => {
    const plan = convergeBrief({ order: order(), root, sources: sources(), rules: [] })
    expect(plan.prompt).toContain('`risk.triggers` is a closed set')
  })

  // The other half of the same failure: the plan that came back had seven
  // units in one lane, which cost seven cold sessions for work that was serial
  // in one checkout.
  it('says a unit separates work that cannot share a checkout, not work that touches different files', () => {
    const plan = convergeBrief({ order: order(), root, sources: sources(), rules: [] })
    expect(plan.prompt).toContain('smallest plan that covers the ask')
  })

  it('says which checks would refuse the order as it stands', () => {
    const plan = convergeBrief({ order: order(), root, sources: sources(), rules: [] })
    // An empty draft fails coverage; telling the architect that is the whole
    // point — it is being asked to fix exactly this.
    expect(plan.prompt).toContain('**coverage**')
  })

  it('says nothing is wrong when nothing is', () => {
    const complete = order({
      intent: { problem: 'p', outcome: 'o', nonGoals: [] },
      risk: { grade: 'P2', triggers: [], blastRadius: ['src/'], criticalPaths: [] },
      acceptance: [
        {
          id: 'AC-1',
          statement: 'a',
          priority: 'P1',
          verify: { kind: 'test', command: 'npm test', assert: 'exit_code == 0' },
          unverifiable: null,
        },
      ],
      plan: {
        ...order().plan,
        units: [
          {
            id: 'U-1',
            title: 'a',
            role: 'builder',
            lane: 1,
            dependsOn: [],
            satisfies: ['AC-1'],
            touches: ['src/a.ts'],
            verify: [],
          },
        ],
      },
    })
    const plan = convergeBrief({ order: complete, root, sources: sources(), rules: [] })
    expect(plan.prompt).toContain('Nothing, as it stands')
  })

  it('refuses to let the agent agree its own work', () => {
    const plan = convergeBrief({ order: order(), root, sources: sources(), rules: [] })
    expect(plan.prompt).toContain('you\ndo not agree your own work')
  })

  it('carries what the operator just said, when they said something', () => {
    const plan = convergeBrief({
      order: order(),
      root,
      sources: sources(),
      rules: [],
      message: 'the second unit is not needed',
    })
    expect(plan.prompt).toContain('What the operator just said')
    expect(plan.prompt).toContain('the second unit is not needed')
  })

  it('says nothing about the operator when they said nothing', () => {
    const plan = convergeBrief({ order: order(), root, sources: sources(), rules: [] })
    expect(plan.prompt).not.toContain('What the operator just said')
  })

  it('runs in the repository, not in a worktree cut for a plan that may never be agreed', () => {
    expect(convergeBrief({ order: order(), root, sources: sources(), rules: [] }).cwd).toBe(repo)
  })

  it('says so when there is no architect to run', () => {
    expect(() =>
      convergeBrief({
        order: order(),
        root,
        sources: sources({ builtInDir: path.join(root, 'nowhere') }),
        rules: [],
      })
    ).toThrow(NoArchitectError)
  })
})

describe('reading back what it wrote', () => {
  function write(value: unknown): string {
    const file = path.join(orderDir(root, 'WO-1'), 'proposal.json')
    fs.mkdirSync(path.dirname(file), { recursive: true })
    fs.writeFileSync(file, typeof value === 'string' ? value : JSON.stringify(value))
    return file
  }

  const CRITERION = {
    id: 'AC-1',
    statement: 'an expired token is refused',
    priority: 'P0',
    verify: { kind: 'test', command: 'npm test', assert: 'exit_code == 0' },
    unverifiable: null,
  }

  it('merges a proposal into the order', () => {
    const file = write({ acceptance: [CRITERION], note: 'first draft' })
    const result = readProposal(order(), file, '2026-09-06T12:00:00.000Z')
    expect(result.ok).toBe(true)
    expect(result.ok && result.order.acceptance).toHaveLength(1)
    expect(result.ok && result.note).toBe('first draft')
  })

  it('says so when the architect wrote nothing', () => {
    const result = readProposal(order(), path.join(root, 'nothing.json'), 'now')
    expect(result).toEqual({ ok: false, reason: 'the architect wrote no proposal' })
  })

  it('refuses one that is not readable JSON, rather than half-applying it', () => {
    const file = write('{{{')
    const result = readProposal(order(), file, 'now')
    expect(result.ok).toBe(false)
    expect(!result.ok && result.reason).toMatch(/not readable/)
  })

  it('refuses one that reaches for a field it may not have', () => {
    const file = write({ status: 'agreed' })
    const result = readProposal(order(), file, 'now')
    expect(result.ok).toBe(false)
    expect(!result.ok && result.reason).toMatch(/refused/)
  })

  it('clears the file whatever happened, so a stale one is never read as this turn', () => {
    const file = write({ note: 'x' })
    readProposal(order(), file, 'now')
    expect(fs.existsSync(file)).toBe(false)

    const bad = write('{{{')
    readProposal(order(), bad, 'now')
    expect(fs.existsSync(bad)).toBe(false)
  })

  it('leaves the order a draft — converging is not agreeing', () => {
    const file = write({ acceptance: [CRITERION] })
    const result = readProposal(order(), file, 'now')
    expect(result.ok && result.order.status).toBe('draft')
  })
})

describe('when the proposal is read', () => {
  function write(value: unknown): string {
    const file = path.join(orderDir(root, 'WO-1'), 'proposal.json')
    fs.mkdirSync(path.dirname(file), { recursive: true })
    fs.writeFileSync(file, typeof value === 'string' ? value : JSON.stringify(value))
    return file
  }

  it('is not read while the file is not there — a turn ending is not the architect finishing', () => {
    // It thinks, replies, asks something, and may write on a later turn.
    // Reading at the first turn end reported "wrote no proposal" while it was
    // still working.
    const missing = path.join(orderDir(root, 'WO-1'), 'proposal.json')
    expect(fs.existsSync(missing)).toBe(false)
  })

  it('is read once it is there, whatever turn wrote it', () => {
    const file = write({ note: 'on the third turn' })
    const result = readProposal(order(), file, 'now')
    expect(result.ok && result.note).toBe('on the third turn')
  })
})
