import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as nodePath from 'node:path'
import {
  COLLECTABLE,
  collectableWrites,
  rungOutputPath,
  rungOutputContract,
  parseRungOutput,
  applyRungOutput,
  RungOutputRejected,
  readRungOutput,
} from '../../src/line/rung-output.js'
import { draftOrder } from '../../src/order/schema.js'
import type { WorkOrder } from '../../src/order/schema.js'
import type { Role } from '../../src/recipe/parse.js'

// A read-only rung has a product — context, findings, a plan it disagrees
// with — and before this it had nowhere to put it. These are the tests for the
// channel: what a role is entitled to write, what the brief tells it, and
// where each artefact lands on the order.

const AT = '2026-09-08T02:00:00.000Z'

function role(over: Partial<Role> = {}): Role {
  return {
    schemaVersion: 1,
    id: 'scout',
    modelTier: 'fast',
    allowResume: false,
    reads: ['repo'],
    writes: ['context'],
    tools: ['read'],
    prompt: 'Read this repository.',
    ...over,
  }
}

function order(over: Partial<WorkOrder> = {}): WorkOrder {
  const base = draftOrder({
    id: 'WO-1',
    title: 'x',
    source: { kind: 'typed', tracker: null, key: null, url: null },
    repoPaths: ['/repo'],
    now: '2026-09-08T01:00:00.000Z',
  })
  return { ...base, status: 'agreed', agreedAt: '2026-09-08T01:30:00.000Z', ...over }
}

describe('collectableWrites', () => {
  it('keeps only the artefacts this channel knows how to take', () => {
    expect(collectableWrites(role({ writes: ['context', 'schedule'] }))).toEqual(['context'])
  })

  it('is empty for a role that writes to the checkout', () => {
    // The builder's product is the diff. It has a channel already, and giving
    // it a second one would be two answers to "what did this rung do".
    expect(collectableWrites(role({ writes: ['worktree'] }))).toEqual([])
  })

  it('is empty for a role that declared nothing', () => {
    expect(collectableWrites(role({ writes: [] }))).toEqual([])
    expect(collectableWrites(null)).toEqual([])
  })

  it('names every artefact the built-in roles actually declare', () => {
    // Guards the vocabulary against drift: a role file that starts writing
    // something this module has never heard of would silently lose it.
    expect(Object.keys(COLLECTABLE).sort()).toEqual(
      ['acceptance', 'context', 'findings', 'plan'].sort()
    )
  })
})

describe('rungOutputPath', () => {
  it('puts a rung beside the order that asked for it', () => {
    expect(rungOutputPath('/data/orders/WO-1', 'challenge')).toBe(
      '/data/orders/WO-1/rungs/challenge.json'
    )
  })

  it('refuses a node id that would escape the order', () => {
    // The node id reaches here from a recipe, which is a file on disk that
    // Foundry did not write.
    expect(() => rungOutputPath('/data/orders/WO-1', '../../etc/passwd')).toThrow(
      /does not name a rung/
    )
    expect(() => rungOutputPath('/data/orders/WO-1', 'build/U-1')).toThrow(/does not name a rung/)
  })
})

describe('rungOutputContract', () => {
  it('names the file and nothing else counts', () => {
    const text = rungOutputContract('/data/orders/WO-1/rungs/scout.json', ['context'])
    expect(text).toContain('/data/orders/WO-1/rungs/scout.json')
    expect(text).toContain('Nothing else you do counts')
  })

  it('offers only the keys the role declared it writes', () => {
    const scout = rungOutputContract('/x.json', ['context'])
    expect(scout).toContain('"findings"')
    expect(scout).not.toContain('"redTeam"')
    expect(scout).not.toContain('"acceptance"')

    const redTeam = rungOutputContract('/x.json', ['findings'])
    expect(redTeam).toContain('"redTeam"')
    expect(redTeam).not.toContain('"entryPoints"')
  })

  it('is empty when the role has nothing to hand back', () => {
    // A contract with no keys would be an instruction to write `{}`, which is
    // a turn spent producing nothing.
    expect(rungOutputContract('/x.json', [])).toBe('')
  })
})

describe('parseRungOutput', () => {
  it('takes what the role was entitled to write', () => {
    const parsed = parseRungOutput(
      { findings: { entryPoints: ['src/a.ts'], conventions: ['tokens'] }, note: 'read it' },
      ['context']
    )
    expect(parsed.findings?.entryPoints).toEqual(['src/a.ts'])
    expect(parsed.note).toBe('read it')
  })

  it('refuses a key the role did not declare', () => {
    // The whole point of keying on `writes:`: a scout that decided to rewrite
    // the plan is refused here rather than reminded in a prompt.
    expect(() => parseRungOutput({ plan: { units: [], lanes: [] } }, ['context'])).toThrow(
      RungOutputRejected
    )
  })

  it('refuses a key no role may ever write', () => {
    expect(() => parseRungOutput({ status: 'shipped' }, ['context', 'findings'])).toThrow(/status/)
  })

  it('refuses a finding with no text', () => {
    expect(() =>
      parseRungOutput({ redTeam: [{ severity: 'high', text: '' }] }, ['findings'])
    ).toThrow(RungOutputRejected)
  })
})

describe('applyRungOutput', () => {
  it('puts what the scout read into the order it was read for', () => {
    const before = order()
    expect(before.context.entryPoints).toEqual([])

    const after = applyRungOutput(before, {
      role: 'scout',
      output: parseRungOutput(
        { findings: { entryPoints: ['src/styles.css'], priorArt: ['abc123 did it'] } },
        ['context']
      ),
      writes: ['context'],
      at: AT,
    })

    expect(after.order.context.entryPoints).toEqual(['src/styles.css'])
    expect(after.order.context.priorArt).toEqual(['abc123 did it'])
    // Untouched: what Foundry measured is not the agent's to overwrite.
    expect(after.order.context.repos).toEqual(before.context.repos)
    expect(after.defect).toBeNull()
  })

  it('leaves an order agreed when a rung only reports what it read', () => {
    // A scout's findings are not a disagreement, and sending an order back to
    // draft mid-run would stop the builders already working from it.
    const after = applyRungOutput(order(), {
      role: 'scout',
      output: parseRungOutput({ findings: { conventions: ['colour lives in tokens'] } }, [
        'context',
      ]),
      writes: ['context'],
      at: AT,
    })
    expect(after.order.status).toBe('agreed')
    expect(after.order.agreedAt).not.toBeNull()
  })

  it("puts the red team's findings where the structural ones go", () => {
    const after = applyRungOutput(order(), {
      role: 'red-team',
      output: parseRungOutput(
        { redTeam: [{ severity: 'high', text: 'AC-2 cannot be falsified.' }] },
        ['findings']
      ),
      writes: ['findings'],
      at: AT,
    })

    expect(after.order.redTeam).toHaveLength(1)
    expect(after.order.redTeam[0]?.text).toBe('AC-2 cannot be falsified.')
    expect(after.order.redTeam[0]?.status).toBe('open')
    // A finding is exactly as binding as the six checks, so it takes the
    // amendment path like every other change to an agreed order.
    expect(after.order.status).toBe('draft')
    expect(after.order.provenance.amendments.at(-1)).toContain('red-team')
    // And it reaches somebody. At intake the compile gate refuses an order
    // that gained a finding; on the Line there is no compile gate, so a
    // finding that raised nothing would revert the order to draft under a run
    // that carried on building from it regardless.
    expect(after.defect).toContain('AC-2 cannot be falsified.')
  })

  it('raises nothing for a finding it had already made', () => {
    const once = applyRungOutput(order(), {
      role: 'red-team',
      output: parseRungOutput({ redTeam: [{ severity: 'low', text: 'same' }] }, ['findings']),
      writes: ['findings'],
      at: AT,
    })
    const again = applyRungOutput(once.order, {
      role: 'red-team',
      output: parseRungOutput({ redTeam: [{ severity: 'low', text: 'same' }] }, ['findings']),
      writes: ['findings'],
      at: AT,
    })
    expect(again.defect).toBeNull()
  })

  it('numbers agent findings so a second turn does not duplicate the first', () => {
    const once = applyRungOutput(order(), {
      role: 'red-team',
      output: parseRungOutput({ redTeam: [{ severity: 'low', text: 'same' }] }, ['findings']),
      writes: ['findings'],
      at: AT,
    })
    const twice = applyRungOutput(once.order, {
      role: 'red-team',
      output: parseRungOutput({ redTeam: [{ severity: 'low', text: 'same' }] }, ['findings']),
      writes: ['findings'],
      at: AT,
    })
    expect(twice.order.redTeam).toHaveLength(1)
  })

  it('reports a plan the architect disagrees with rather than applying it', () => {
    // The graph was compiled from the agreed plan before this rung ran, so
    // swapping the plan underneath running builders would orphan every node
    // already in flight. It becomes a question for the operator instead.
    const before = order({
      plan: {
        units: [
          {
            id: 'U-1',
            title: 'one',
            role: 'builder',
            lane: 1,
            dependsOn: [],
            satisfies: [],
            touches: ['src/a.ts'],
            verify: [],
          },
        ],
        lanes: [{ ord: 1, repo: 'repo', branch: '', role: null, blocks: [], blockedBy: [] }],
        sharedFiles: [],
      },
    })

    const after = applyRungOutput(before, {
      role: 'architect',
      output: parseRungOutput(
        {
          plan: {
            units: [
              {
                id: 'U-9',
                title: 'nine',
                role: 'builder',
                lane: 1,
                dependsOn: [],
                satisfies: [],
                touches: ['src/b.ts'],
                verify: [],
              },
            ],
            lanes: [{ ord: 1, repo: 'repo', branch: '', role: null, blocks: [], blockedBy: [] }],
            sharedFiles: [],
          },
          note: 'three things in the order are wrong',
        },
        ['plan', 'acceptance']
      ),
      writes: ['plan', 'acceptance'],
      at: AT,
    })

    expect(after.order.plan.units.map((u) => u.id)).toEqual(['U-1'])
    expect(after.defect).toContain('three things in the order are wrong')
    expect(after.defect).toContain('already building from')
    // Recorded on the order, so the disagreement outlives the terminal it was
    // written in even if nobody answers the gate.
    expect(after.order.provenance.decisions.at(-1)).toContain('architect')
  })

  it('says nothing changed when the rung wrote an empty object', () => {
    const before = order()
    const after = applyRungOutput(before, {
      role: 'scout',
      output: parseRungOutput({}, ['context']),
      writes: ['context'],
      at: AT,
    })
    expect(after.order).toEqual(before)
    expect(after.note).toBe('')
    expect(after.defect).toBeNull()
  })
})

describe('readRungOutput', () => {
  let dir: string
  let file: string

  beforeEach(() => {
    dir = fs.mkdtempSync(nodePath.join(os.tmpdir(), 'fdry-rung-'))
    file = nodePath.join(dir, 'challenge.json')
  })

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true })
  })

  it('reads what the rung wrote and puts it on the order', () => {
    fs.writeFileSync(
      file,
      JSON.stringify({ redTeam: [{ severity: 'high', text: 'AC-2 cannot be falsified' }] })
    )
    const result = readRungOutput({
      order: order(),
      role: 'red-team',
      writes: ['findings'],
      outputPath: file,
      at: AT,
    })

    expect(result?.ok).toBe(true)
    if (result?.ok !== true) throw new Error('expected a reading')
    expect(result.order.redTeam[0]?.text).toBe('AC-2 cannot be falsified')
  })

  it('clears the file, so the next turn cannot read this one as its own', () => {
    fs.writeFileSync(file, JSON.stringify({ note: 'x' }))
    readRungOutput({ order: order(), role: 'scout', writes: ['context'], outputPath: file, at: AT })
    expect(fs.existsSync(file)).toBe(false)
  })

  it('clears the file even when what it held was refused', () => {
    fs.writeFileSync(file, JSON.stringify({ status: 'shipped' }))
    const result = readRungOutput({
      order: order(),
      role: 'scout',
      writes: ['context'],
      outputPath: file,
      at: AT,
    })
    expect(result?.ok).toBe(false)
    expect(fs.existsSync(file)).toBe(false)
  })

  it('says the rung wrote nothing when there is no file', () => {
    expect(
      readRungOutput({
        order: order(),
        role: 'scout',
        writes: ['context'],
        outputPath: file,
        at: AT,
      })
    ).toBeNull()
  })

  it('refuses text that is not JSON, rather than throwing at the caller', () => {
    fs.writeFileSync(file, 'here is my report, in prose')
    const result = readRungOutput({
      order: order(),
      role: 'scout',
      writes: ['context'],
      outputPath: file,
      at: AT,
    })
    expect(result?.ok).toBe(false)
    if (result?.ok !== false) throw new Error('expected a refusal')
    expect(result.reason).toContain('not readable')
  })
})
