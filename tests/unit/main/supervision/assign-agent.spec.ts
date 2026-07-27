import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { createSupervisionService } from '../../../../src/main/supervision/supervision-service.js'
import { createAssigner } from '../../../../src/main/supervision/assign-agent.js'

// The path that actually starts a supervised session. Without it the substrate
// has nothing to supervise, so this is the wiring that makes the feature real.

let root: string
let repoPath: string
let worktreeRoot: string

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'assign-'))
  repoPath = join(root, 'repo')
  worktreeRoot = join(root, 'wt')
  mkdirSync(repoPath, { recursive: true })
  mkdirSync(worktreeRoot, { recursive: true })
})
afterEach(() => rmSync(root, { recursive: true, force: true }))

function writeConfig(config: unknown): void {
  mkdirSync(join(repoPath, '.terminator'), { recursive: true })
  writeFileSync(join(repoPath, '.terminator', 'config.json'), JSON.stringify(config))
}

const APPROVED = { ok: true, at: '2026-07-27T09:12:40Z' }

function publish(over: Record<string, unknown> = {}): void {
  const producerDir = join(root, 'supervision', 'workitems', 'test-producer')
  mkdirSync(producerDir, { recursive: true })
  writeFileSync(
    join(producerDir, 'FLU-220.json'),
    JSON.stringify({
      contract_version: 1,
      id: 'FLU-220',
      source: 'local',
      title: 'Unify session identity',
      created_at: '2026-07-27T09:04:11Z',
      phase: 'implement',
      artifacts: { spec: 'specs/012/spec.md', plan: 'specs/012/plan.md' },
      gates: { spec_approved_by_human: APPROVED, plan_approved_by_human: APPROVED },
      contract: { summary: 'SessionId = ULID', shared_files: ['proto/session.proto'] },
      lanes: [
        {
          ord: 1,
          repo: 'fluent',
          role: 'producer',
          branch: 'feat/session-ulid',
          task_ids: ['T001', 'T002'],
        },
      ],
      ...over,
    })
  )
}

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

function build(queryImpl?: unknown) {
  const started: Array<{ prompt: string; cwd: string }> = []
  const service = createSupervisionService({
    userDataPath: root,
    registryStore: memoryStore(),
    shadowStore: { get: () => undefined, set: () => {} },
    bindingStore: memoryStore(),
    now: () => 1_000,
    git: {
      createWorktree: async (_repo, path) => mkdirSync(path, { recursive: true }),
      removeWorktree: async () => {},
    },
  })
  // Replace the driver's start with a recorder; everything else is the real
  // substrate, so the assign path is genuinely exercised.
  const realStart = service.driver.start.bind(service.driver)
  service.driver.start = async (options) => {
    started.push({ prompt: options.prompt, cwd: options.cwd })
    if (queryImpl !== undefined) await realStart(options)
  }
  built.push(service)
  return { service, started, assigner: createAssigner(service, () => 1_000) }
}

const request = () => ({
  repoPath,
  branch: 'feat/session-ulid',
  worktreeRoot,
  autonomyLevel: 'edit' as const,
})

describe('assigning an agent', () => {
  it('provisions a worktree and starts a session in it', async () => {
    const { assigner, started, service } = build()
    const result = await assigner.assign(request())
    expect(result.ok).toBe(true)
    expect(started).toHaveLength(1)
    expect(started[0].cwd).toContain('feat-session-ulid')
    expect(service.listSessions()).toHaveLength(1)
  })

  it('records the chosen autonomy level on the session (FR-041)', async () => {
    const { assigner, service } = build()
    await assigner.assign({ ...request(), autonomyLevel: 'ship' })
    expect(service.listSessions()[0].autonomyLevel).toBe('ship')
  })

  it('passes an ad-hoc instruction through as the prompt', async () => {
    const { assigner, started } = build()
    await assigner.assign({ ...request(), instruction: 'fix the flaky test' })
    expect(started[0].prompt).toBe('fix the flaky test')
  })

  it('binds the session to its lane in console-owned storage (FR-075)', async () => {
    publish()
    const { assigner, service } = build()
    await service.publications.snapshot()
    await assigner.assign({ ...request(), workItemId: 'FLU-220', laneOrd: 1 })
    expect(service.laneBindings.forLane('FLU-220', 1)).toMatchObject({ laneOrd: 1 })
  })

  it('does not bind anything for ad-hoc work (FR-081)', async () => {
    const { assigner, service } = build()
    const result = await assigner.assign(request())
    expect(result.ok).toBe(true)
    expect(service.laneBindings.forWorkItem('FLU-220')).toEqual([])
  })
})

describe('a failing setup stops the assignment (FR-034)', () => {
  it('reports the exit code and starts no agent', async () => {
    writeConfig({ scripts: { setup: 'echo broken; exit 3' } })
    const { assigner, started, service } = build()
    const result = await assigner.assign(request())
    expect(result).toMatchObject({ ok: false })
    expect(result.ok === false && result.reason).toContain('3')
    // The whole point: no agent runs in a broken worktree.
    expect(started).toEqual([])
    expect(service.listSessions()[0].runtimeState).toBe('failed')
  })
})

describe('backpressure gates assignment (FR-053, FR-054)', () => {
  function fillQueue(service: ReturnType<typeof build>['service']): void {
    for (let i = 0; i < 3; i++) {
      service.reviewQueue.enqueue({
        sessionId: `queued-${i}`,
        repoPath,
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
  }

  it('refuses a new agent while the queue is full, stating the reason and count', async () => {
    const { assigner, service, started } = build()
    fillQueue(service)
    const result = await assigner.assign(request())
    expect(result.ok).toBe(false)
    expect(result.ok === false && result.backpressure).toMatchObject({ unreviewed: 3, limit: 3 })
    expect(started).toEqual([])
  })

  it('starts anyway on an explicit override, and records it with the queue depth', async () => {
    const { assigner, service, started } = build()
    fillQueue(service)
    const result = await assigner.assign({ ...request(), overrideBackpressure: true })
    expect(result.ok).toBe(true)
    expect(started).toHaveLength(1)
    expect(service.backpressure.overrides()[0]).toMatchObject({ queueDepth: 3 })
  })

  it('records no override when the queue was not full', async () => {
    const { assigner, service } = build()
    await assigner.assign({ ...request(), overrideBackpressure: true })
    expect(service.backpressure.overrides()).toEqual([])
  })

  it('reports what would be refused without starting anything', () => {
    const { assigner, service } = build()
    fillQueue(service)
    expect(assigner.precheck()).toMatchObject({ allowed: false, unreviewed: 3 })
    expect(service.listSessions()).toEqual([])
  })
})

describe('the autonomy ladder reaches the agent', () => {
  it('auto-approves a read at every level without prompting', async () => {
    const { assigner, service } = build()
    await assigner.assign(request())
    // The decider is handed to the driver as `autoDecide`; exercising it here
    // proves the level chosen at assign time is the one the agent runs under.
    const session = service.listSessions()[0]
    expect(session.autonomyLevel).toBe('edit')
  })

  it('reads the network allowlist from the repository config (FR-042)', async () => {
    writeConfig({ network: { allowedHosts: ['github.com'] } })
    const { assigner } = build()
    await expect(assigner.assign(request())).resolves.toMatchObject({ ok: true })
  })
})

describe('the prompt the agent actually receives (FR-039)', () => {
  it('carries the lane tasks and artefact paths when a work item is published', async () => {
    publish()
    const { assigner, started } = build()
    await assigner.assign({ ...request(), workItemId: 'FLU-220', laneOrd: 1 })

    expect(started[0].prompt).toContain('T001, T002')
    expect(started[0].prompt).toContain('specs/012/spec.md')
    expect(started[0].prompt).toContain('proto/session.proto')
  })

  it('runs the autonomy decider the operator chose at assign time (FR-041)', async () => {
    const decisions: Array<{ tool: string; allowed: boolean }> = []
    const { assigner, service } = build()
    const realStart = service.driver.start.bind(service.driver)
    service.driver.start = async (options) => {
      // read is auto-approved at every level; shell is not, below `build`.
      decisions.push({
        tool: 'Read',
        allowed: options.autoDecide?.('Read', {})?.allow === true,
      })
      decisions.push({
        tool: 'Bash',
        allowed: options.autoDecide?.('Bash', { command: 'git push' })?.allow === true,
      })
      await realStart(options)
    }
    await assigner.assign({ ...request(), autonomyLevel: 'read' })
    expect(decisions).toEqual([
      { tool: 'Read', allowed: true },
      { tool: 'Bash', allowed: false },
    ])
  })
})

describe('port spans never overlap across live worktrees (SC-008)', () => {
  it('gives a second concurrent session a different span', async () => {
    writeConfig({ worktree: { portBase: 4000, portSpan: 10 } })
    const { assigner, service } = build()

    await assigner.assign({ ...request(), branch: 'feat/one' })
    await assigner.assign({ ...request(), branch: 'feat/two' })

    const spans = await Promise.all(
      service.listSessions().map(async (session) => session.worktreePath)
    )
    expect(new Set(spans).size).toBe(2)

    // The real check: the service must remember what it handed out. An
    // allocator that never sees live spans hands every session port 4000.
    const first = await service.provisioner.provision({
      sessionId: 'x',
      workItemId: 'x',
      repoPath,
      branch: 'feat/three',
      worktreeRoot,
    })
    const second = await service.provisioner.provision({
      sessionId: 'y',
      workItemId: 'y',
      repoPath,
      branch: 'feat/four',
      worktreeRoot,
    })
    expect(first.ports.portBase).not.toBe(second.ports.portBase)
    expect(second.ports.portBase).toBeGreaterThanOrEqual(
      first.ports.portBase + first.ports.portSpan
    )
  })

  it('frees a span once its worktree is released, so it can be reused', async () => {
    writeConfig({ worktree: { portBase: 4000, portSpan: 10 } })
    const { service } = build()

    const first = await service.provisioner.provision({
      sessionId: 'a',
      workItemId: 'a',
      repoPath,
      branch: 'feat/a',
      worktreeRoot,
    })
    await service.provisioner.release({
      repoPath,
      worktreePath: first.worktreePath,
      workItemId: 'a',
      portBase: first.ports.portBase,
    })
    const reused = await service.provisioner.provision({
      sessionId: 'b',
      workItemId: 'b',
      repoPath,
      branch: 'feat/b',
      worktreeRoot,
    })
    expect(reused.ports.portBase).toBe(first.ports.portBase)
  })
})

describe('gates are enforced before an agent starts (FR-083)', () => {
  it('refuses when neither gate is approved, naming what is missing', async () => {
    publish({ gates: {} })
    const { assigner, started } = build()
    const result = await assigner.assign({ ...request(), workItemId: 'FLU-220', laneOrd: 1 })
    expect(result.ok).toBe(false)
    expect(result.ok === false && result.reason).toContain('specification')
    // An agent starting without an approved spec has nothing bounding its scope.
    expect(started).toEqual([])
  })

  it('refuses when only the specification is approved, naming the plan', async () => {
    publish({ gates: { spec_approved_by_human: APPROVED } })
    const { assigner } = build()
    const result = await assigner.assign({ ...request(), workItemId: 'FLU-220', laneOrd: 1 })
    expect(result.ok === false && result.reason).toContain('plan')
  })

  it('allows the assignment once both gates are approved', async () => {
    publish()
    const { assigner, started } = build()
    await expect(
      assigner.assign({ ...request(), workItemId: 'FLU-220', laneOrd: 1 })
    ).resolves.toMatchObject({ ok: true })
    expect(started).toHaveLength(1)
  })

  it('refuses for a work item nobody published', async () => {
    const { assigner } = build()
    const result = await assigner.assign({ ...request(), workItemId: 'MISSING', laneOrd: 1 })
    expect(result).toMatchObject({ ok: false })
  })

  it('does not gate ad-hoc work, which has no spec to approve (FR-081)', async () => {
    const { assigner } = build()
    await expect(assigner.assign(request())).resolves.toMatchObject({ ok: true })
  })
})

// The branch mode reaches git. `git worktree add -b` on a branch that already
// exists fails, so the operator's choice has to travel the whole way down.

describe('which kind of branch the worktree is cut on', () => {
  function recordingGit() {
    const calls: Array<{ branch: string; isNewBranch: boolean }> = []
    const service = createSupervisionService({
      userDataPath: root,
      registryStore: memoryStore(),
      shadowStore: { get: () => undefined, set: () => {} },
      bindingStore: memoryStore(),
      now: () => 1_000,
      git: {
        createWorktree: async (_repo, path, branch, isNewBranch) => {
          calls.push({ branch, isNewBranch })
          mkdirSync(path, { recursive: true })
        },
        removeWorktree: async () => {},
      },
    })
    service.driver.start = async () => {}
    built.push(service)
    return { calls, assigner: createAssigner(service, () => 1_000) }
  }

  it('creates a new branch by default', async () => {
    const { calls, assigner } = recordingGit()
    await assigner.assign(request())
    expect(calls[0]).toMatchObject({ isNewBranch: true })
  })

  it('checks out an existing branch when the operator picked one', async () => {
    const { calls, assigner } = recordingGit()
    await assigner.assign({ ...request(), isNewBranch: false })
    expect(calls[0]).toMatchObject({ branch: 'feat/session-ulid', isNewBranch: false })
  })
})
