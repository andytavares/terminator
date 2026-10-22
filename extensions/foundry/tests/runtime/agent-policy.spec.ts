import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import * as fs from 'node:fs'
import * as path from 'node:path'
import type { ExtensionAPI } from '@terminator/extension-sdk'

import {
  trustRepository,
  isProbedCommand,
  readOnlyAutoDecide,
} from '../../src/runtime/agent-policy.js'
import { draftOrder } from '../../src/order/draft.js'
import type { WorkOrder } from '../../src/order/schema.js'
import type { LedgerEntry } from '../../src/ledger/append.js'
import { temporaryDirectory } from '../helpers/foundry-host.js'
import { partialFake } from '../../../../tests/support/fakes'
import { eventually } from '../../../../tests/support/eventually'

function orderProbing(test: string | null): WorkOrder {
  const base = draftOrder({
    id: 'WO-1',
    title: 'x',
    source: { kind: 'typed', tracker: null, key: null, url: null },
    repoPaths: ['/repos/app'],
    now: '2026-10-12T10:00:00.000Z',
  })
  return {
    ...base,
    context: {
      ...base.context,
      toolchain: {
        ...base.context.toolchain,
        test: test === null ? null : { command: test, source: 'hint' },
      },
    },
  } as WorkOrder
}

describe('a command the toolchain probe found', () => {
  const order = orderProbing('npm test')

  it('may run exactly as found, or followed by a read-only step that reports its status', () => {
    expect(isProbedCommand(order, 'Bash', { command: ' npm test ' })).toBe(true)
    expect(isProbedCommand(order, 'Bash', { command: 'npm test; echo "EXIT=$?"' })).toBe(true)
  })

  it('may not carry a write along with it, or arguments it was not found with', () => {
    expect(isProbedCommand(order, 'Bash', { command: 'npm test; rm -rf .' })).toBe(false)
    expect(isProbedCommand(order, 'Bash', { command: 'npm test -- --update' })).toBe(false)
  })

  it('is never another tool, a command that is not a string, or anything when nothing was probed', () => {
    expect(isProbedCommand(order, 'Write', { command: 'npm test' })).toBe(false)
    expect(isProbedCommand(order, 'Bash', { command: 42 })).toBe(false)
    expect(isProbedCommand(order, 'Bash', null)).toBe(false)
    expect(isProbedCommand(orderProbing(null), 'Bash', { command: 'npm test' })).toBe(false)
  })
})

describe('a read-only turn in the Forge', () => {
  const decide = readOnlyAutoDecide('/data/orders/WO-1/proposal.json')

  it('writes its one file and nothing else', () => {
    expect(decide('Write', { file_path: '/data/orders/WO-1/proposal.json' })).toEqual({
      allow: true,
    })
    expect(decide('Write', { file_path: '/repos/app/src/a.ts' }).allow).toBe(false)
  })

  it('reads what the read-only policy allows', () => {
    expect(decide('Read', { file_path: '/repos/app/src/a.ts' }).allow).toBe(true)
  })
})

let home: string
const entries: LedgerEntry[] = []
const api = partialFake<ExtensionAPI>({ log: partialFake<ExtensionAPI['log']>({ error: vi.fn() }) })

describe('trusting the repository an agent starts in', () => {
  beforeEach(() => {
    home = temporaryDirectory('fdry-home')
    vi.stubEnv('HOME', home)
    entries.length = 0
    vi.mocked(api.log.error).mockClear()
  })

  afterEach(() => vi.unstubAllEnvs())

  describe('trusting', agentPolicyTrustingTests)
})

function agentPolicyTrustingTests() {
  const store = { record: async (entry: LedgerEntry) => void entries.push(entry) }

  it('marks it trusted in the Claude Code configuration and says so on the order', async () => {
    fs.writeFileSync(path.join(home, '.claude.json'), JSON.stringify({ projects: {} }))
    trustRepository(api, '/repos/app', { orderId: 'WO-1', store })
    const config = JSON.parse(fs.readFileSync(path.join(home, '.claude.json'), 'utf8'))
    expect(config.projects['/repos/app'].hasTrustDialogAccepted).toBe(true)
    await eventually(() => expect(entries.map((e) => e.action)).toEqual(['workspace.trusted']))
    expect(entries[0]).toMatchObject({ orderId: 'WO-1', subject: '/repos/app' })
  })

  it('records nothing when it was already trusted', () => {
    fs.writeFileSync(
      path.join(home, '.claude.json'),
      JSON.stringify({ projects: { '/repos/app': { hasTrustDialogAccepted: true } } })
    )
    trustRepository(api, '/repos/app', { orderId: 'WO-1', store })
    expect(entries).toEqual([])
    expect(api.log.error).not.toHaveBeenCalled()
  })

  it('logs that the agent will stop at the dialog when the configuration cannot be written', () => {
    const config = path.join(home, '.claude.json')
    fs.writeFileSync(config, JSON.stringify({ projects: {} }))
    // Something already sits where the new configuration is written first.
    fs.mkdirSync(`${config}.foundry-${process.pid}.tmp`)
    trustRepository(api, '/repos/app', { orderId: 'WO-1', store })
    expect(api.log.error).toHaveBeenCalledWith(expect.stringContaining('trust dialog'))
    expect(entries).toEqual([])
  })
}
