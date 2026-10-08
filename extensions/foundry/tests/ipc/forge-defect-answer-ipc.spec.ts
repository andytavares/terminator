/**
 * "Answer" on a `forge-defect` gate, end to end.
 *
 * The finding that raises this gate already sent the order back to `draft`
 * (`amendOrder`), and `runs.resume` refuses anything that is not `running` —
 * so the button called it anyway and did nothing (docs/research/foundry-red-
 * team-loop.md, cause 3). This drives the real `act` closure through
 * `activate`, because the decision it makes now — converge instead of resume,
 * and a resume failure recorded rather than swallowed — lives entirely inside
 * that closure.
 */
import { tmpdir } from 'node:os'
import * as fs from 'node:fs'
import * as path from 'node:path'

const USER_DATA = tmpdir()

import { describe, it, expect, beforeAll, beforeEach } from 'vitest'
import { vi } from 'vitest'
import type { ExtensionAPI } from '../../../../src/main/extensions/api.js'
import { createOrderStore } from '../../src/order/store.js'
import { draftOrder } from '../../src/order/draft.js'
import type { WorkOrder } from '../../src/order/schema.js'
import type { Gate } from '../../src/gates/rules.js'

vi.mock('electron', () => ({
  BrowserWindow: { getAllWindows: vi.fn().mockReturnValue([]) },
  safeStorage: {
    isEncryptionAvailable: vi.fn().mockReturnValue(false),
    encryptString: vi.fn(),
    decryptString: vi.fn(),
  },
  app: { getPath: vi.fn().mockReturnValue(USER_DATA) },
}))

const runner = {
  start: vi.fn(),
  resolve: vi.fn(),
  handBackToTerminal: vi.fn(),
  interrupt: vi.fn(),
  stop: vi.fn().mockReturnValue(true),
  send: vi.fn().mockReturnValue(true),
  terminalFor: vi.fn().mockReturnValue(null),
  watchable: vi.fn().mockReturnValue([]),
  dispose: vi.fn(),
}

vi.mock('../../src/runtime/supervised-runner.js', () => ({
  createSupervisedRunner: () => runner,
}))

vi.mock('../../src/runtime/control-server.js', () => ({
  createControlServer: vi.fn().mockResolvedValue({
    url: 'http://127.0.0.1:1/pretooluse',
    eventUrl: 'http://127.0.0.1:1/event',
    token: 'token',
    register: vi.fn().mockReturnValue(() => {}),
    close: vi.fn(),
  }),
}))

let getHandler: (channel: string) => ((payload: unknown) => Promise<unknown>) | undefined
let api: ExtensionAPI
let dataDir = ''
const settingsGet = vi.fn((key: string) =>
  key === 'terminator.foundry.dataDir' ? dataDir : undefined
)

function call(channel: string, payload: unknown = {}): Promise<unknown> {
  const handler = getHandler(channel)
  if (handler === undefined) throw new Error(`${channel} is not registered`)
  return handler(payload)
}

function order(over: Partial<WorkOrder> = {}): WorkOrder {
  const base = draftOrder({
    id: 'WO-1',
    title: 'Make the thing work',
    source: { kind: 'typed', tracker: null, key: null, url: null },
    repoPaths: ['/repos/a'],
    now: '2026-09-06T10:00:00.000Z',
  })
  return { ...base, status: 'draft', recipe: 'direct', ...over }
}

function ledger(): string {
  const file = path.join(dataDir, 'orders', 'WO-1', 'ledger.jsonl')
  return fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : ''
}

function saveGate(gate: Gate): void {
  fs.writeFileSync(path.join(dataDir, 'orders', 'WO-1', 'gates.json'), JSON.stringify([gate]))
}

function forgeDefectGate(): Gate {
  return {
    id: 'WO-1-forge-defect',
    rule: 'forge-defect',
    orderId: 'WO-1',
    nodeId: null,
    summary: 's',
    why: 'the order contradicts itself',
    evidence: [],
    options: [
      { id: 'answer', label: 'Answer', consequence: 'c' },
      { id: 'hold', label: 'Hold', consequence: 'c' },
    ],
    defaultIfIgnored: 'hold',
    deadline: null,
    blockedUnits: 0,
    riskGrade: 'P3',
    raisedAt: '2026-09-06T10:00:00.000Z',
    decision: null,
  }
}

beforeAll(async () => {
  const handlers = new Map<string, (payload: unknown) => Promise<unknown>>()
  api = {
    ipc: {
      registerHandler: vi.fn((channel: string, handler: (payload: unknown) => Promise<unknown>) => {
        handlers.set(channel, handler)
        return { dispose: vi.fn() }
      }),
      invokeChannel: vi.fn(),
      sendChannel: vi.fn(),
      onWindowEvent: vi.fn().mockReturnValue(() => {}),
      isRemoteAccessible: vi.fn().mockReturnValue(false),
    },
    window: { broadcast: vi.fn(), openAuxiliary: vi.fn(), focusSelf: vi.fn(), showSelf: vi.fn() },
    commands: { register: vi.fn().mockReturnValue({ dispose: vi.fn() }), setEnabled: vi.fn() },
    shell: { exec: vi.fn().mockResolvedValue({ exitCode: 0, stdout: '', stderr: '' }) },
    notifications: { showToast: vi.fn(), createNotification: vi.fn() },
    log: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    settings: {
      register: vi.fn().mockReturnValue({ dispose: vi.fn() }),
      get: settingsGet,
      set: vi.fn(),
      resolveWorktreeBaseDir: vi.fn().mockReturnValue(path.join(tmpdir(), 'fdry-worktrees')),
    },
    terminal: {
      onSessionCreate: vi.fn().mockReturnValue({ dispose: vi.fn() }),
      onSessionClose: vi.fn().mockReturnValue({ dispose: vi.fn() }),
    },
    workspace: {
      list: vi.fn().mockReturnValue([]),
      listProjects: vi.fn().mockReturnValue([]),
      createProject: vi.fn(),
      deleteProject: vi.fn(),
      onDelete: vi.fn().mockReturnValue({ dispose: vi.fn() }),
      onProjectDelete: vi.fn().mockReturnValue({ dispose: vi.fn() }),
    },
    pty: {
      spawn: vi.fn(),
      write: vi.fn(),
      resize: vi.fn(),
      kill: vi.fn(),
      listSessions: vi.fn().mockReturnValue([]),
      attachOnData: vi.fn().mockReturnValue(null),
      attachOnExit: vi.fn().mockReturnValue(null),
      openTerminalTab: vi.fn(),
    },
    app: { version: '0.0.0-test' },
  } as unknown as ExtensionAPI

  const { activate, startSupervisionRuntime } = await import('../../src/index.ts')
  activate(api)
  getHandler = (channel) => handlers.get(channel)
  if ((await startSupervisionRuntime(api)) === null) {
    throw new Error('the supervision runtime did not start')
  }
})

beforeEach(() => {
  runner.start.mockReset()
  runner.start.mockImplementation(
    async (input: { onRegistered?: (run: { sessionId: string }) => void }) => {
      input.onRegistered?.({ sessionId: 'architect-session' })
      return { sessionId: 'architect-session' }
    }
  )
})

describe('answering a forge-defect gate', () => {
  it('starts the architect on every open blocking finding, rather than resuming, when the order is not running', async () => {
    dataDir = fs.mkdtempSync(path.join(tmpdir(), 'fdry-forge-defect-'))
    const store = createOrderStore(dataDir)
    await store.save(
      order({
        redTeam: [
          {
            id: 'RT-2',
            severity: 'high',
            text: 'drops canceled tickets',
            status: 'open',
            reason: '',
            category: 'regression',
            round: 1,
          },
        ],
      })
    )
    saveGate(forgeDefectGate())

    const r = (await call('foundry:inbox.decide', {
      gateId: 'WO-1-forge-defect',
      option: 'answer',
    })) as { ok: boolean; actionError?: string }

    expect(r.actionError).toBeUndefined()
    expect(runner.start).toHaveBeenCalledTimes(1)
    const started = runner.start.mock.calls[0][0] as { phase: string; prompt: string }
    expect(started.phase).toBe('architect')
    expect(started.prompt).toContain('RT-2')
  })

  it('records a resume failure as gate.action_failed, rather than a silent no-op', async () => {
    dataDir = fs.mkdtempSync(path.join(tmpdir(), 'fdry-forge-defect-resume-'))
    const store = createOrderStore(dataDir)
    // No red-team findings: `fixMessage` is null, and the gate's own rule name
    // is what the architect turn (or, on a rule this test does not special-
    // case, the resume failure) has to name instead.
    await store.save(order({ status: 'draft' }))
    saveGate({
      ...forgeDefectGate(),
      id: 'WO-1-critical-path',
      rule: 'critical-path',
      options: [
        { id: 'approve', label: 'Approve', consequence: 'c' },
        { id: 'hold', label: 'Hold', consequence: 'c' },
      ],
    })

    const r = (await call('foundry:inbox.decide', {
      gateId: 'WO-1-critical-path',
      option: 'approve',
    })) as { ok: boolean; actionError?: string }

    expect(r.actionError).toContain('draft')
    expect(ledger()).toContain('gate.action_failed')
    expect(runner.start).not.toHaveBeenCalled()
  })
})

/**
 * WO-1008-287, end to end: the operator handed the order off, the inspector
 * sent it back with a defect, the operator answered, and the architect amended
 * the plan. The amended order must run again — and an order nobody released
 * must say so on the Inbox rather than sit there.
 */
describe('after the architect amends an answered defect', () => {
  function cleanOrder(): WorkOrder {
    const base = order()
    return {
      ...base,
      recipe: null,
      intent: { problem: 'p', outcome: 'rows render fully', nonGoals: ['scrollbars'] },
      risk: { grade: 'P2', triggers: [], blastRadius: ['src/'], criticalPaths: [] },
      acceptance: [
        {
          id: 'AC-1',
          statement: 'a full-width row renders its final glyph',
          priority: 'P1',
          verify: { kind: 'test', command: 'npm test', assert: 'exit_code == 0' },
          unverifiable: null,
        },
      ],
      plan: {
        ...base.plan,
        units: [
          {
            id: 'U-1',
            title: 'widen',
            role: 'builder',
            lane: 1,
            dependsOn: [],
            satisfies: ['AC-1'],
            touches: ['src/a.ts'],
            verify: [],
          },
        ],
      },
      redTeam: [
        {
          id: 'RT-inspector-6',
          severity: 'high',
          text: 'footnote links stop working',
          status: 'open',
          reason: '',
          category: 'regression',
          round: 1,
        },
      ],
    }
  }

  function architectAmends(): void {
    runner.start.mockImplementation(
      async (input: {
        phase: string
        onRegistered?: (run: { sessionId: string }) => void
        onTurnEnd?: () => void
      }) => {
        const sessionId = `${input.phase}-session`
        input.onRegistered?.({ sessionId })
        if (input.phase === 'architect') {
          fs.writeFileSync(
            path.join(dataDir, 'orders', 'WO-1', 'proposal.json'),
            JSON.stringify({
              note: 'Added AC-5 so footnote links survive the sanitizer',
              resolveFindings: [{ id: 'RT-inspector-6', how: 'prefix #… hrefs in the a override' }],
            })
          )
          setTimeout(() => input.onTurnEnd?.(), 0)
        }
        return { sessionId }
      }
    )
  }

  async function seed(released: boolean): Promise<void> {
    dataDir = fs.mkdtempSync(path.join(tmpdir(), 'fdry-amended-'))
    const store = createOrderStore(dataDir)
    await store.save(cleanOrder())
    if (released) {
      await store.record({
        at: '2026-10-08T01:55:24.000Z',
        orderId: 'WO-1',
        actor: 'operator',
        action: 'order.agreed',
        subject: 'WO-1',
        reason: 'all checks pass',
        evidence: [],
      })
    }
    saveGate(forgeDefectGate())
    architectAmends()
  }

  it('agrees the released order again and starts its run', async () => {
    await seed(true)
    await call('foundry:inbox.decide', { gateId: 'WO-1-forge-defect', option: 'answer' })

    await vi.waitFor(() => expect(ledger()).toContain('"action":"run.started"'), {
      timeout: 5000,
    })
    const lines = ledger()
      .trim()
      .split('\n')
      .map((l) => JSON.parse(l) as { action: string; actor: string })
    expect(lines.filter((l) => l.action === 'order.agreed').at(-1)?.actor).toBe('rule:forge')
    expect(lines.some((l) => l.action === 'converge.started')).toBe(true)
    expect((await createOrderStore(dataDir).load('WO-1'))?.status).toBe('running')
  })

  it('lists an order nobody released on the Inbox, and counts it on the badge', async () => {
    await seed(false)
    await call('foundry:inbox.decide', { gateId: 'WO-1-forge-defect', option: 'answer' })

    await vi.waitFor(() => expect(ledger()).toContain('order.redrafted'), { timeout: 5000 })
    await vi.waitFor(
      async () => {
        const inbox = (await call('foundry:inbox.list')) as {
          waiting: { orderId: string; headline: string }[]
        }
        expect(inbox.waiting).toEqual([
          expect.objectContaining({ orderId: 'WO-1', headline: 'Ready to hand off' }),
        ])
      },
      { timeout: 5000 }
    )
    expect(((await call('foundry:attention')) as { inbox: number }).inbox).toBe(1)
    expect((await createOrderStore(dataDir).load('WO-1'))?.status).toBe('draft')
    expect(ledger()).not.toContain('run.started')
  })

  // Recording which conversation wrote the plan loads the whole order and
  // saves it back. Unordered, that save could land after the amendment's and
  // put the old plan back: the answered finding open again, and the restart
  // refused with "the adversarial pass left 1 blocking finding unresolved".
  // Seen in CI as the test above timing out.
  it('never puts the order from before the amendment back', async () => {
    await seed(true)
    const orderFile = path.join(dataDir, 'orders', 'WO-1', 'order.json')
    const readFile = fs.promises.readFile
    let holdNextRead = false
    // The read that starts the conversation record returns late, holding the
    // order as it was before the amendment.
    const spy = vi.spyOn(fs.promises, 'readFile').mockImplementation((async (
      file: fs.PathLike,
      options?: unknown
    ) => {
      const contents = await readFile(file, options as BufferEncoding)
      if (holdNextRead && String(file) === orderFile) {
        holdNextRead = false
        await new Promise((resolve) => setTimeout(resolve, 100))
      }
      return contents
    }) as typeof fs.promises.readFile)
    runner.start.mockImplementation(
      async (input: {
        phase: string
        onRegistered?: (run: { sessionId: string }) => void
        onTurnEnd?: () => void
      }) => {
        const sessionId = `${input.phase}-session`
        if (input.phase === 'architect') {
          fs.writeFileSync(
            path.join(dataDir, 'orders', 'WO-1', 'proposal.json'),
            JSON.stringify({
              note: 'Added AC-5 so footnote links survive the sanitizer',
              resolveFindings: [{ id: 'RT-inspector-6', how: 'prefix #… hrefs in the a override' }],
            })
          )
          holdNextRead = true
        }
        input.onRegistered?.({ sessionId })
        if (input.phase === 'architect') input.onTurnEnd?.()
        return { sessionId }
      }
    )

    try {
      await call('foundry:inbox.decide', { gateId: 'WO-1-forge-defect', option: 'answer' })
      await vi.waitFor(() => expect(ledger()).toMatch(/"action":"run\.(started|refused)"/), {
        timeout: 2000,
      })
      await new Promise((resolve) => setTimeout(resolve, 200))
    } finally {
      spy.mockRestore()
    }

    expect(ledger()).not.toContain('run.refused')
    expect(ledger()).toContain('"action":"run.started"')
    const saved = await createOrderStore(dataDir).load('WO-1')
    expect(saved?.redTeam.find((f) => f.id === 'RT-inspector-6')?.status).toBe('resolved')
  })
})
