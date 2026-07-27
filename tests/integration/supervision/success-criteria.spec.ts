import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { createSupervisionService } from '../../../src/main/supervision/supervision-service.js'
import {
  registerSupervisionHandlers,
  SUPERVISION_CHANNELS,
} from '../../../src/main/ipc/supervision.ipc.js'
import { rankAttention, summariseStatus } from '../../../src/shared/supervision/rank-attention.js'

// Measured against the real substrate and the real IPC handlers. Only the
// agent runtime is faked — the path a permission request travels to reach a
// listing surface is the production one.

vi.mock('electron', () => ({
  ipcMain: { handle: vi.fn(), on: vi.fn(), removeHandler: vi.fn() },
  app: { getPath: vi.fn().mockReturnValue('/tmp') },
}))

let userDataPath: string

beforeEach(() => (userDataPath = mkdtempSync(join(tmpdir(), 'sc-'))))
afterEach(() => rmSync(userDataPath, { recursive: true, force: true }))

function memoryStore() {
  let value: unknown
  return { get: () => value, set: (v: unknown) => (value = v) }
}

const built: Array<{ stop(): void }> = []

afterEach(() => {
  // Each service holds a publication watcher; leaking them starves the
  // filesystem watcher other tests depend on.
  while (built.length > 0) built.pop()?.stop()
})

function build() {
  const pushed: Array<{ sessionId: string; to: string; at: number }> = []
  const service = createSupervisionService({
    userDataPath,
    registryStore: memoryStore(),
    shadowStore: (() => {
      let v: boolean | undefined
      return { get: () => v, set: (n: boolean) => (v = n) }
    })(),
    now: () => Date.now(),
    onStateChanged: (change) => pushed.push(change),
  })
  built.push(service)
  return { service, pushed }
}

const meta = {
  workItemId: null,
  laneOrd: null,
  repoPath: '/repo',
  worktreePath: '/wt',
  branch: 'feat/x',
  autonomyLevel: 'edit' as const,
}

describe('SC-001 — a blocked session is visible within 2 seconds', () => {
  it('reaches every listing surface in well under the budget', () => {
    const { service, pushed } = build()
    service.registry.register('s1', meta)
    service.bus.publish({
      kind: 'session_started',
      sessionId: 's1',
      transcriptPath: '/t',
      cwd: '/repo',
      at: Date.now(),
    })

    const requestedAt = Date.now()
    service.bus.publish({
      kind: 'permission_requested',
      sessionId: 's1',
      requestId: 'r1',
      toolName: 'Bash',
      summary: 'redis-cli -h prod-cache-01',
      targetHost: 'prod-cache-01',
      at: requestedAt,
    })

    // Visible on the list the surfaces read.
    const listed = service.listSessions().find((s) => s.id === 's1')
    const visibleAt = Date.now()

    expect(listed?.runtimeState).toBe('needs_input')
    expect(listed?.pendingPermission?.summary).toContain('redis-cli')
    expect(visibleAt - requestedAt).toBeLessThan(2_000)

    // And pushed outward rather than waiting to be polled — the push is what
    // makes the budget achievable end to end.
    expect(pushed.at(-1)).toMatchObject({ sessionId: 's1', to: 'needs_input' })
  })

  it('names what is being requested, so the operator need not open the session', () => {
    const { service } = build()
    service.registry.register('s1', meta)
    service.bus.publish({
      kind: 'permission_requested',
      sessionId: 's1',
      requestId: 'r1',
      toolName: 'Bash',
      summary: 'rm -rf build',
      at: Date.now(),
    })
    const [item] = rankAttention(service.listSessions(), Date.now())
    expect(item.pendingPermission?.summary).toBe('rm -rf build')
  })

  it('travels the real IPC handler within budget', async () => {
    const { service } = build()
    service.registry.register('s1', meta)
    service.bus.publish({
      kind: 'permission_requested',
      sessionId: 's1',
      requestId: 'r1',
      toolName: 'Bash',
      summary: 'ls',
      at: Date.now(),
    })

    const handlers = new Map<string, (e: unknown, p?: unknown) => unknown>()
    const { ipcMain } = (await import('electron')) as unknown as {
      ipcMain: {
        handle: { mock: { calls: Array<[string, (e: unknown, p?: unknown) => unknown]> } }
      }
    }
    registerSupervisionHandlers(service)
    for (const [channel, handler] of ipcMain.handle.mock.calls) handlers.set(channel, handler)

    const start = Date.now()
    const sessions = (await handlers.get(SUPERVISION_CHANNELS.listSessions)!({})) as Array<{
      runtimeState: string
    }>
    expect(Date.now() - start).toBeLessThan(2_000)
    expect(sessions[0].runtimeState).toBe('needs_input')
  })
})

describe('SC-003 — the state of every session from one surface', () => {
  it('reports every session state and the oldest blocked age in one call', () => {
    const { service } = build()
    const now = Date.now()
    for (const id of ['a', 'b', 'c', 'd', 'e', 'f']) service.registry.register(id, meta)

    service.bus.publish({
      kind: 'permission_requested',
      sessionId: 'a',
      requestId: 'r1',
      toolName: 'Bash',
      summary: 'ls',
      at: now - 60_000,
    })
    service.bus.publish({
      kind: 'session_started',
      sessionId: 'b',
      transcriptPath: '/t',
      cwd: '/r',
      at: now,
    })
    service.bus.publish({
      kind: 'session_ended',
      sessionId: 'c',
      outcome: 'error',
      reason: 'error_max_turns',
      at: now,
    })

    const start = Date.now()
    const sessions = service.listSessions()
    const summary = summariseStatus(sessions, now)
    const attention = rankAttention(sessions, now)
    const elapsed = Date.now() - start

    // One call, one surface, and fast enough that reading it is the only cost.
    expect(sessions).toHaveLength(6)
    expect(elapsed).toBeLessThan(30_000)
    expect(summary.needsInput).toBe(1)
    expect(summary.failed).toBe(1)
    expect(summary.oldestBlockedMs).toBeGreaterThanOrEqual(60_000)
    // Ranked worst-first so triage starts at the top.
    expect(attention[0].reason).toBe('needs_input')
  })

  it('leaves nothing unaccounted for — every session carries a state', () => {
    const { service } = build()
    for (const id of ['a', 'b', 'c']) service.registry.register(id, meta)
    for (const session of service.listSessions()) {
      expect(session.runtimeState).toBeTruthy()
      expect(typeof session.stateSince).toBe('number')
    }
  })
})

describe('SC-004 — an override is always recorded', () => {
  it('records every override with the queue depth at the time', () => {
    const { service } = build()
    for (let i = 0; i < 3; i++) {
      service.reviewQueue.enqueue({
        sessionId: `s${i}`,
        repoPath: '/repo',
        branch: 'feat/x',
        diffSummary: { files: 1, added: 1, removed: 0 },
        change: {
          files: ['src/a.ts'],
          linesChanged: 1,
          checkState: 'passing',
          sharedContractFiles: [],
          criticalPaths: [],
        },
        queuedAt: Date.now(),
      })
    }
    expect(service.backpressure.check().allowed).toBe(false)
    service.backpressure.override('s9', Date.now())
    expect(service.backpressure.overrides()).toHaveLength(1)
    expect(service.backpressure.overrides()[0].queueDepth).toBe(3)
  })
})

describe('SC-009 — nothing reaches the default branch unrecorded', () => {
  it('refuses unattended merge unless a repository explicitly enabled it', () => {
    const { service } = build()
    expect(
      service.mergePolicy.mayMergeUnattended({
        sessionId: 's1',
        repoPath: '/repo',
        grade: 'P3',
        gradeTrigger: 'lockfile only',
        checkState: 'passing',
        diffSummary: { files: 1, added: 1, removed: 0 },
      })
    ).toMatchObject({ may: false })
  })

  it('records every unattended merge so it can be reviewed afterwards (SC-012)', () => {
    const { service } = build()
    service.mergePolicy.recordUnattendedMerge(
      {
        sessionId: 's1',
        repoPath: '/repo',
        grade: 'P3',
        gradeTrigger: 'lockfile only',
        checkState: 'passing',
        diffSummary: { files: 1, added: 2, removed: 1 },
      },
      Date.now()
    )
    expect(service.mergePolicy.unattendedMerges()).toHaveLength(1)
  })
})

describe('SC-010 — reported state matches the durable record after restart', () => {
  it('never reports a mid-flight session as working after a restart (FR-009)', () => {
    const store = memoryStore()
    const first = createSupervisionService({
      userDataPath,
      registryStore: store,
      shadowStore: { get: () => undefined, set: () => {} },
      now: () => 1_000,
    })
    first.registry.register('s1', meta)
    first.bus.publish({
      kind: 'session_started',
      sessionId: 's1',
      transcriptPath: '/t',
      cwd: '/r',
      at: 2_000,
    })
    expect(first.getSession('s1')?.runtimeState).toBe('working')
    first.stop()

    const second = createSupervisionService({
      userDataPath,
      registryStore: store,
      shadowStore: { get: () => undefined, set: () => {} },
      now: () => 9_999,
    })
    expect(second.getSession('s1')?.runtimeState).toBe('unknown')
    second.stop()
  })
})
