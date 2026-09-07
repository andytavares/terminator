import { describe, it, expect } from 'vitest'
import { inspectionFor, regrade } from '../../src/verify/inspection-triggers.js'
import { draftOrder } from '../../src/order/schema.js'
import type { WorkOrder } from '../../src/order/schema.js'

// The triggers come from the grader that already exists rather than a second
// list kept in step by hand. What is added here is only what the grader does
// not speak to: what a change brings in, and where it went that it should not
// have.

function order(over: Partial<WorkOrder> = {}): WorkOrder {
  const base = draftOrder({
    id: 'WO-1',
    title: 'x',
    source: { kind: 'typed', tracker: null, key: null, url: null },
    repoPaths: ['/repos/a'],
    now: '2026-09-06T10:00:00.000Z',
  })
  return { ...base, ...over }
}

function input(files: string[], over: Partial<Parameters<typeof inspectionFor>[1]> = {}) {
  return { changedFiles: files, linesChanged: 20, checkState: 'passing' as const, ...over }
}

describe('inspectionFor', () => {
  it('runs no inspection on a change that trips nothing', () => {
    const i = inspectionFor(order(), input(['src/components/Button.tsx']))
    expect(i.required).toBe(false)
    expect(i.triggers).toEqual([])
  })

  it('triggers on authentication', () => {
    expect(inspectionFor(order(), input(['src/auth/session.ts'])).triggers).toContain(
      'authentication'
    )
  })

  it('triggers on secrets', () => {
    expect(inspectionFor(order(), input(['src/secrets/vault.ts'])).triggers).toContain('secrets')
  })

  it('triggers on a data migration', () => {
    expect(inspectionFor(order(), input(['db/migrations/001_add.sql'])).triggers).toContain(
      'migration'
    )
  })

  it('triggers on a new dependency, which the grader does not speak to', () => {
    expect(inspectionFor(order(), input(['package.json'])).triggers).toContain('new_dependency')
  })

  it('triggers on a manifest in any of the languages it knows', () => {
    for (const manifest of ['Cargo.toml', 'go.mod', 'pyproject.toml', 'Gemfile']) {
      expect(inspectionFor(order(), input([manifest])).triggers).toContain('new_dependency')
    }
  })

  it('triggers when the change enters an operator-declared critical path', () => {
    const o = order()
    o.risk.criticalPaths = ['src/renderer/components/Terminal*']
    expect(
      inspectionFor(o, input(['src/renderer/components/TerminalPane.tsx'])).triggers
    ).toContain('critical_path')
  })

  it('does not invent a critical path where the operator declared none', () => {
    expect(inspectionFor(order(), input(['src/anything.ts'])).triggers).not.toContain(
      'critical_path'
    )
  })

  it('triggers when the change goes outside what the order declared', () => {
    const o = order()
    o.risk.blastRadius = ['src/renderer/']
    const i = inspectionFor(o, input(['src/renderer/a.ts', 'scripts/release.sh']))
    expect(i.triggers).toContain('outside_blast_radius')
  })

  it('does not trigger while the change stays inside the blast radius', () => {
    const o = order()
    o.risk.blastRadius = ['src/renderer/']
    expect(inspectionFor(o, input(['src/renderer/a.ts'])).triggers).not.toContain(
      'outside_blast_radius'
    )
  })

  it('keeps the grader own words, so a gate can show the specific reason', () => {
    expect(inspectionFor(order(), input(['src/auth/session.ts'])).reason).toBeTruthy()
  })

  it('grades a change that also touches something trivial by the worst thing in it', () => {
    // The grader checks P3 last on purpose: a lockfile change that also touches
    // authentication must not slip into the quiet lane.
    const i = inspectionFor(order(), input(['package-lock.json', 'src/auth/session.ts']))
    expect(i.grade).toBe('P0')
    expect(i.triggers).toContain('authentication')
  })

  it('reads the accumulated change, so a unit finishing early cannot skip it', () => {
    const i = inspectionFor(order(), input(['src/a.ts', 'src/b.ts', 'src/auth/login.ts']))
    expect(i.required).toBe(true)
  })

  it('does not repeat a trigger that two files both raise', () => {
    const i = inspectionFor(order(), input(['package.json', 'Cargo.toml']))
    expect(i.triggers.filter((t) => t === 'new_dependency')).toHaveLength(1)
  })
})

describe('regrade', () => {
  it('brings the order risk block up to date with what the change actually did', () => {
    const o = order()
    o.risk.blastRadius = ['src/']
    const next = regrade(o, input(['src/auth/session.ts']))
    expect(next.grade).toBe('P0')
    expect(next.triggers).toContain('authentication')
  })

  it('leaves the operator-declared parts alone', () => {
    const o = order()
    o.risk.criticalPaths = ['src/x/**']
    o.risk.blastRadius = ['src/']
    const next = regrade(o, input(['src/a.ts']))
    expect(next.criticalPaths).toEqual(['src/x/**'])
    expect(next.blastRadius).toEqual(['src/'])
  })
})
