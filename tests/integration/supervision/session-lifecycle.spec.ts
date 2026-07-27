import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { createSupervisionService } from '../../../src/main/supervision/supervision-service.js'
import { createProvisioner } from '../../../src/main/supervision/worktree/provisioner.js'
import { createLaneBindings } from '../../../src/main/supervision/workitems/lane-bindings.js'
import { readFileSync, readdirSync } from 'fs'

// End-to-end through the real substrate: only the agent runtime is faked.
// These are the scenarios quickstart.md runs by hand.

let userDataPath: string

beforeEach(() => (userDataPath = mkdtempSync(join(tmpdir(), 'supervision-int-'))))
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
  const stateChanges: Array<{ sessionId: string; to: string; at: number }> = []
  let clock = 1_000
  const service = createSupervisionService({
    userDataPath,
    registryStore: memoryStore(),
    shadowStore: (() => {
      let v: boolean | undefined
      return { get: () => v, set: (next: boolean) => (v = next) }
    })(),
    bindingStore: memoryStore(),
    now: () => clock,
    onStateChanged: (change) => stateChanges.push(change),
  })
  built.push(service)
  return { service, stateChanges, tick: (ms: number) => (clock += ms) }
}

const meta = {
  workItemId: null,
  laneOrd: null,
  repoPath: '/repo',
  worktreePath: '/wt/s1',
  branch: 'feat/x',
  autonomyLevel: 'edit' as const,
}

describe('a session driven from request to review (SC-001)', () => {
  it('reaches needs_input, returns to working, then lands in the review queue', () => {
    const { service, stateChanges } = build()
    service.registry.register('s1', meta)

    service.bus.publish({
      kind: 'session_started',
      sessionId: 's1',
      transcriptPath: '/tmp/s1.jsonl',
      cwd: '/repo',
      at: 2_000,
    })
    expect(service.getSession('s1')?.runtimeState).toBe('working')

    service.bus.publish({
      kind: 'permission_requested',
      sessionId: 's1',
      requestId: 'r1',
      toolName: 'Bash',
      summary: 'redis-cli -h prod-cache-01',
      targetHost: 'prod-cache-01',
      at: 3_000,
    })
    // Visible on a listing surface, naming what is being asked, without
    // anything having opened the session.
    const blocked = service.getSession('s1')
    expect(blocked?.runtimeState).toBe('needs_input')
    expect(blocked?.pendingPermission?.summary).toContain('redis-cli')

    service.bus.publish({
      kind: 'permission_resolved',
      sessionId: 's1',
      requestId: 'r1',
      decision: 'allow',
      at: 4_000,
    })
    expect(service.getSession('s1')?.runtimeState).toBe('working')

    // Every transition was pushed outward exactly once. Registering a session
    // is not itself a transition — it publishes no event — so the first push is
    // the move into working.
    expect(stateChanges.map((c) => c.to)).toEqual(['working', 'needs_input', 'working'])
  })

  it('ends a session with no changes without queuing it for review (FR-045)', () => {
    const { service } = build()
    service.registry.register('s1', meta)
    service.bus.publish({
      kind: 'session_started',
      sessionId: 's1',
      transcriptPath: '/t',
      cwd: '/repo',
      at: 2_000,
    })
    service.bus.publish({ kind: 'session_ended', sessionId: 's1', outcome: 'success', at: 5_000 })
    expect(service.getSession('s1')?.runtimeState).toBe('merged')
    expect(service.reviewQueue.count()).toBe(0)
  })

  it('surfaces a failed setup without starting an agent (FR-034)', () => {
    const { service } = build()
    service.registry.register('s1', meta)
    service.bus.publish({
      kind: 'setup_finished',
      sessionId: 's1',
      exitCode: 3,
      output: 'pnpm install failed',
      at: 2_000,
    })
    expect(service.getSession('s1')?.runtimeState).toBe('failed')
  })
})

describe('stall detection through the service', () => {
  it('records a firing in shadow mode without touching visible state (FR-018)', () => {
    const { service } = build()
    service.registry.register('s1', meta)
    service.bus.publish({
      kind: 'session_started',
      sessionId: 's1',
      transcriptPath: '/t',
      cwd: '/repo',
      at: 2_000,
    })
    service.stalls.surface({
      sessionId: 's1',
      signal: 'silence',
      firedAt: 9 * 60_000,
      inputs: {
        toolSilenceMs: 9 * 60_000,
        diffSilenceMs: 0,
        distinctFiles: 0,
        netChange: 0,
        reverts: 0,
        shellInFlight: false,
      },
    })
    expect(service.firings.list()).toHaveLength(1)
    expect(service.getSession('s1')?.runtimeState).toBe('working')
  })
})

describe('backpressure across repositories', () => {
  it('counts unreviewed work globally, because review capacity is one person', () => {
    const { service } = build()
    for (const [id, repo] of [
      ['a', '/repo-a'],
      ['b', '/repo-b'],
      ['c', '/repo-c'],
    ]) {
      service.reviewQueue.enqueue({
        sessionId: id,
        repoPath: repo,
        branch: 'feat/x',
        diffSummary: { files: 1, added: 1, removed: 0 },
        change: {
          files: ['src/a.ts'],
          linesChanged: 1,
          checkState: 'passing',
          sharedContractFiles: [],
          criticalPaths: [],
        },
        queuedAt: 1_000,
      })
    }
    const decision = service.backpressure.check()
    expect(decision.allowed).toBe(false)
    expect(decision.reason).toContain('3')

    service.backpressure.override('d', 9_000)
    expect(service.backpressure.overrides()[0]).toMatchObject({ queueDepth: 3 })
  })
})

describe('concurrent provisioning (SC-008)', () => {
  it('allocates non-overlapping port spans to two worktrees of one repository', async () => {
    const repoPath = join(userDataPath, 'repo')
    const worktreeRoot = join(userDataPath, 'wt')
    mkdirSync(repoPath, { recursive: true })
    mkdirSync(worktreeRoot, { recursive: true })
    mkdirSync(join(repoPath, '.terminator'), { recursive: true })
    writeFileSync(
      join(repoPath, '.terminator', 'config.json'),
      JSON.stringify({ worktree: { portBase: 4000, portSpan: 10 } })
    )

    const taken: Array<{ portBase: number; portSpan: number }> = []
    const provisioner = createProvisioner({
      git: {
        createWorktree: async (_repo, path) => mkdirSync(path, { recursive: true }),
        removeWorktree: async () => {},
      },
      isPortFree: () => true,
      activeSpans: () => taken,
      publish: () => {},
      now: () => 1_000,
    })

    for (const branch of ['feat/one', 'feat/two']) {
      const result = await provisioner.provision({
        sessionId: branch,
        workItemId: 'FLU-220',
        repoPath,
        branch,
        worktreeRoot,
      })
      taken.push(result.ports)
    }

    const [first, second] = taken
    expect(first.portBase).not.toBe(second.portBase)
    expect(second.portBase).toBeGreaterThanOrEqual(first.portBase + first.portSpan)
  })
})

describe('the producer boundary (FR-073, FR-075)', () => {
  it('leaves every producer file byte-for-byte unchanged when a session is bound', () => {
    const producerDir = join(userDataPath, 'supervision', 'workitems', 'speckit-pilot')
    mkdirSync(producerDir, { recursive: true })
    const contractPath = join(producerDir, 'FLU-220.json')
    const original = JSON.stringify({
      contract_version: 1,
      id: 'FLU-220',
      source: 'local',
      title: 'Unify session identity',
      created_at: '2026-07-27T09:04:11Z',
      phase: 'implement',
      lanes: [{ ord: 1, repo: 'fluent', role: 'producer', branch: 'feat/x' }],
    })
    writeFileSync(contractPath, original)

    const before = readdirSync(producerDir).map((name) => [
      name,
      readFileSync(join(producerDir, name), 'utf-8'),
    ])

    const bindings = createLaneBindings(memoryStore())
    bindings.bind('FLU-220', 1, 'b1e2', 1_000)
    bindings.bind('FLU-220', 1, 'replacement', 2_000)
    bindings.unbind('FLU-220', 1)

    const after = readdirSync(producerDir).map((name) => [
      name,
      readFileSync(join(producerDir, name), 'utf-8'),
    ])
    // The sharpest test of the boundary: the whole directory is untouched.
    expect(after).toEqual(before)
  })
})

describe('the console works with no producer at all (FR-081)', () => {
  it('supervises sessions as ad-hoc work and reports no work items', () => {
    const { service } = build()
    service.registry.register('s1', meta)
    expect(service.listSessions()).toHaveLength(1)
    expect(service.listSessions()[0].workItemId).toBeNull()
    expect(service.publications.snapshot().items).toEqual([])
  })
})

describe('one screen answers "is anything wrong" (SC-003)', () => {
  it('summarises every session state without opening any of them', () => {
    const { service } = build()
    const states: Array<[string, 'needs_input' | 'stalled' | 'failed' | 'ready']> = [
      ['a', 'needs_input'],
      ['b', 'stalled'],
      ['c', 'failed'],
      ['d', 'ready'],
    ]
    for (const [id] of states) service.registry.register(id, meta)

    const sessions = service.listSessions()
    expect(sessions).toHaveLength(4)
    // Every one carries a state and the time it entered it — nothing here
    // requires reading a transcript.
    for (const session of sessions) {
      expect(session.runtimeState).toBeTruthy()
      expect(typeof session.stateSince).toBe('number')
    }
  })
})

describe('shutdown', () => {
  it('stops the scheduler and closes the publication watcher', () => {
    const { service } = build()
    service.start()
    expect(() => service.stop()).not.toThrow()
    expect(() => service.stop()).not.toThrow()
  })
})

describe('the runtime seam is the only SDK importer (SC-007)', () => {
  it('keeps the neutral event shape free of runtime types', async () => {
    const { readFileSync: read } = await import('fs')
    const source = read('src/main/supervision/events/session-event.ts', 'utf-8')
    expect(source).not.toContain('@anthropic-ai')
    expect(source.match(/^\s*import\s.+$/gm) ?? []).toEqual([])
  })

  it('has exactly one file under src/ importing the agent SDK', async () => {
    const { execSync } = await import('child_process')
    const hits = execSync(
      "grep -rl '@anthropic-ai/claude-agent-sdk' src --include='*.ts' --include='*.tsx' || true",
      { encoding: 'utf-8' }
    )
      .split('\n')
      .filter((line) => line.trim() !== '')
    expect(hits).toEqual(['src/main/supervision/agent-runtime/driver.ts'])
  })
})

vi.setConfig({ testTimeout: 20_000 })
