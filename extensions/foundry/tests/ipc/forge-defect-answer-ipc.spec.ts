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
