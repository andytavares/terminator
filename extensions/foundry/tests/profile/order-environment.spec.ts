import { describe, it, expect } from 'vitest'
import { WorkOrderSchema, type RiskAssessment } from '../../src/order/schema.js'
import { draftOrder } from '../../src/order/draft.js'
import { ladderFor } from '../../src/verify/ladder.js'
import { CHECK_NAMES } from '../../src/verify/check-names.js'
import type { Toolchain } from '../../src/verify/toolchain-probe.js'

const source = { kind: 'typed', tracker: null, key: null, url: null } as const
const draft = () => draftOrder({ id: 'WO-1', title: 't', source, repoPaths: ['/r'], now: 'n' })
const risk: RiskAssessment = { grade: 'P3', triggers: [], blastRadius: [], criticalPaths: [] }

describe('order schema migration', () => {
  it.each(['package.json', 'config', 'makefile', 'ci'])('reads source %s as hint', (old) => {
    const order = JSON.parse(JSON.stringify(draft()))
    order.context.toolchain.test = { command: 'npm run test', source: old }
    expect(WorkOrderSchema.parse(order).context.toolchain.test?.source).toBe('hint')
  })

  it('keeps the new sources as they are', () => {
    const order = JSON.parse(JSON.stringify(draft()))
    order.context.toolchain.lint = { command: 'just lint', source: 'operator' }
    expect(WorkOrderSchema.parse(order).context.toolchain.lint?.source).toBe('operator')
  })

  it('parses an order written before environments existed, with empty defaults', () => {
    const order = JSON.parse(JSON.stringify(draft()))
    delete order.context.environment
    expect(WorkOrderSchema.parse(order).context.environment).toEqual({
      prepare: null,
      share: [],
      pictures: null,
      paths: { interface: [], manifests: [], lockfiles: [] },
      additional: [],
    })
  })
})

describe('ladder with additional checks', () => {
  const toolchain = Object.fromEntries(CHECK_NAMES.map((name) => [name, null])) as Toolchain

  it('places an additional check at its rung as a runnable step', () => {
    const steps = ladderFor({
      toolchain,
      risk,
      touchesUi: false,
      additional: [{ name: 'Types', command: 'tsc --noEmit', rung: 'L1' }],
    })
    const index = steps.findIndex((step) => step.name === 'Types')
    expect(steps[index]).toMatchObject({
      rung: 'L1',
      command: 'tsc --noEmit',
      status: 'runnable',
      check: null,
    })
    expect(steps[index - 1].rung).toBe('L1')
    expect(steps[index + 1].rung).toBe('L2')
  })

  it('does not run an additional check for a change that only touches documentation', () => {
    const steps = ladderFor({
      toolchain,
      risk,
      touchesUi: false,
      changedFiles: ['README.md'],
      additional: [{ name: 'Types', command: 'tsc --noEmit', rung: 'L1' }],
    })
    expect(steps.find((step) => step.name === 'Types')?.status).toBe('not_triggered')
  })
})
