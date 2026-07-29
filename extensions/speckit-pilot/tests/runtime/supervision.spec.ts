import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createSupervision, type Supervision } from '../../src/runtime/supervision.js'

// What is running, what it changed, what needs looking at, and what must not
// start yet. Assembled as one thing here because the closed branch's worst bugs
// were all in wiring that each unit tested fine on its own — the review queue
// was correct and permanently empty, because nothing measured a diff.

let dir: string
let diff: { files: number; added: number; removed: number }
let changedFiles: string[]

function build(over: Partial<Parameters<typeof createSupervision>[0]> = {}): Supervision {
  return createSupervision({
    api: { shell: { exec: async () => ({ exitCode: 0, stdout: '' }) } } as never,
    stateDir: dir,
    // Stands in for git: the numbers are what every decision downstream reads.
    run: async (_command, args) => {
      if (args.includes('ls-files')) return { ok: true, stdout: '' }
      const rows = changedFiles.map((f) => `${diff.added}\t${diff.removed}\t${f}`).join('\n')
      return { ok: true, stdout: diff.files === 0 ? '' : rows }
    },
    ...over,
  })
}

function addRun(
  supervision: Supervision,
  sessionId = 'session-1',
  featureDir = '/repo/specs/021-a'
) {
  return supervision.runs.add({
    sessionId,
    featureDir,
    phase: 'implement',
    worktreePath: '/wt/a',
    branch: 'feat/a',
    terminalSessionId: 'terminal-1',
    transcriptPath: '/t.jsonl',
    startedAt: 0,
  })
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'supervision-'))
  diff = { files: 1, added: 10, removed: 2 }
  changedFiles = ['src/a.ts']
})

afterEach(() => rmSync(dir, { recursive: true, force: true, maxRetries: 5 }))

describe('what is running', () => {
  it('counts a new run as working', () => {
    const s = build()
    addRun(s)
    expect(s.runs.live()).toHaveLength(1)
  })

  it('stops counting one that has finished', async () => {
    const s = build()
    addRun(s)
    await s.finishTurn('session-1', 3, 2_000)
    expect(s.runs.live()).toEqual([])
  })

  it('records the turns it has taken', async () => {
    const s = build()
    addRun(s)
    await s.finishTurn('session-1', 7, 2_000)
    expect(s.runs.get('session-1')?.turns).toBe(7)
  })

  it('drops every run belonging to a card that is gone', () => {
    const s = build()
    addRun(s, 'a', '/repo/specs/021-a')
    addRun(s, 'b', '/repo/specs/022-b')
    s.runs.forgetCard('/repo/specs/021-a')
    expect(s.runs.list().map((r) => r.sessionId)).toEqual(['b'])
  })
})

describe('a turn that produced something', () => {
  it('measures what the working copy changed', async () => {
    // Nothing reported this before, so the diff stayed at zero for a run's
    // whole life and `ready` was unreachable.
    const s = build()
    addRun(s)
    await s.finishTurn('session-1', 1, 2_000)
    expect(s.runs.get('session-1')?.diff).toEqual({ files: 1, added: 10, removed: 2 })
  })

  it('offers it for review', async () => {
    const s = build()
    addRun(s)
    await s.finishTurn('session-1', 1, 2_000)
    expect(s.review.list().map((item) => item.sessionId)).toEqual(['session-1'])
  })

  it('marks the run ready rather than over — the agent is still at its prompt', async () => {
    const s = build()
    addRun(s)
    await s.finishTurn('session-1', 1, 2_000)
    expect(s.runs.get('session-1')?.state).toBe('ready')
  })

  it('grades it, so the queue can be worst-first', async () => {
    changedFiles = ['src/auth/token.ts']
    const s = build()
    addRun(s)
    await s.finishTurn('session-1', 1, 2_000)
    expect(s.review.list()[0].grade).toBe('P0')
  })

  it('carries the changed paths into the grade — without them everything is ordinary', async () => {
    changedFiles = ['migrations/001_add_users.sql']
    const s = build()
    addRun(s)
    await s.finishTurn('session-1', 1, 2_000)
    expect(s.review.list()[0].grade).toBe('P0')
  })

  it('does not assume checks are passing on evidence nobody has', async () => {
    const s = build()
    addRun(s)
    await s.finishTurn('session-1', 1, 2_000)
    // Assuming passing is how a change auto-merges on a green nobody saw.
    expect(s.review.list()[0].checkState).not.toBe('passing')
  })

  it('says so in the feed, with what changed', async () => {
    const s = build()
    addRun(s)
    await s.finishTurn('session-1', 1, 2_000)
    expect(s.feed.list()[0].summary).toMatch(/ready to review/)
  })
})

describe('a turn that produced nothing', () => {
  beforeEach(() => {
    diff = { files: 0, added: 0, removed: 0 }
    changedFiles = []
  })

  it('does not go to review — there is nothing to look at', async () => {
    const s = build()
    addRun(s)
    await s.finishTurn('session-1', 1, 2_000)
    expect(s.review.list()).toEqual([])
  })

  it('does not take a slot in the queue the gate counts', async () => {
    const s = build()
    addRun(s)
    await s.finishTurn('session-1', 1, 2_000)
    expect(s.backpressure.check().allowed).toBe(true)
  })

  it('is still recorded as finished rather than left working forever', async () => {
    const s = build()
    addRun(s)
    await s.finishTurn('session-1', 1, 2_000)
    expect(s.runs.get('session-1')?.state).toBe('finished')
  })
})

describe('backpressure', () => {
  async function fill(s: Supervision, count: number) {
    for (let i = 0; i < count; i += 1) {
      addRun(s, `session-${i}`, `/repo/specs/02${i}-card`)
      await s.finishTurn(`session-${i}`, 1, 2_000)
    }
  }

  it('allows a run while the queue is short', async () => {
    const s = build()
    await fill(s, 2)
    expect(s.backpressure.check().allowed).toBe(true)
  })

  it('refuses one when too many diffs are unreviewed', async () => {
    // The constraint is one person's capacity to review, which does not scale
    // with the number of cards.
    const s = build()
    await fill(s, 3)
    expect(s.backpressure.check().allowed).toBe(false)
  })

  it('says why, rather than a greyed-out button', async () => {
    const s = build()
    await fill(s, 3)
    expect(s.backpressure.check().reason).toBeTruthy()
  })

  it('counts across cards, because attention does not partition by card', async () => {
    const s = build()
    await fill(s, 3)
    expect(s.backpressure.check().unreviewed).toBe(3)
  })

  it('lets the queue drain once something is reviewed', async () => {
    const s = build()
    await fill(s, 3)
    s.review.remove('session-0')
    expect(s.backpressure.check().allowed).toBe(true)
  })

  it('records an override with the depth at the moment it was ignored', async () => {
    const s = build()
    await fill(s, 3)
    s.backpressure.override('session-new', 5_000)
    expect(s.backpressure.overrides()).toHaveLength(1)
  })
})

describe('a run that ends outright', () => {
  it('is ready when it left changes behind', () => {
    const s = build()
    addRun(s)
    s.runs.noteDiff('session-1', { files: 2, added: 5, removed: 1 })
    s.finish('session-1', 3_000)
    expect(s.runs.get('session-1')?.state).toBe('ready')
  })

  it('is simply finished when it left none', () => {
    const s = build()
    addRun(s)
    s.finish('session-1', 3_000)
    expect(s.runs.get('session-1')?.state).toBe('finished')
  })

  it('stays on the register, or the queue would empty when the agent exits', () => {
    const s = build()
    addRun(s)
    s.runs.noteDiff('session-1', { files: 1, added: 1, removed: 0 })
    s.finish('session-1', 3_000)
    expect(s.runs.get('session-1')).not.toBeNull()
  })
})

describe('the snapshot a surface reads', () => {
  it('carries the runs, the queue and the gate in one read', async () => {
    const s = build()
    addRun(s)
    await s.finishTurn('session-1', 1, 2_000)
    const snapshot = s.snapshot()
    expect(snapshot.runs).toHaveLength(1)
    expect(snapshot.review).toHaveLength(1)
    expect(snapshot.backpressure.allowed).toBe(true)
  })
})

describe('reviewing a run hunk by hunk', () => {
  const patch = [
    'diff --git a/src/a.ts b/src/a.ts',
    '--- a/src/a.ts',
    '+++ b/src/a.ts',
    '@@ -1,2 +1,3 @@',
    ' const a = 1',
    '+const b = 2',
    '@@ -10,2 +11,3 @@',
    ' const c = 3',
    '+const d = 4',
  ].join('\n')

  function withPatch(): Supervision {
    return build({
      run: async (_command, args) => {
        if (args.includes('ls-files')) return { ok: true, stdout: '' }
        if (args.includes('--numstat')) return { ok: true, stdout: '2\t0\tsrc/a.ts' }
        return { ok: true, stdout: patch }
      },
    })
  }

  it('splits the diff into hunks rather than offering a file wholesale', async () => {
    // One file routinely holds both the change you asked for and the one you
    // did not; accepting the file is how the second one ships.
    const s = withPatch()
    addRun(s)
    const set = await s.hunksFor('session-1')
    // Two hunks in the one file, each decidable on its own.
    expect(set?.acceptedHunks()).toEqual([])
    expect(set?.isComplete()).toBe(false)
    expect(set?.byFile().map((f) => f.file)).toEqual(['src/a.ts'])
  })

  it('records a decision on one hunk', async () => {
    const s = withPatch()
    addRun(s)
    const set = await s.hunksFor('session-1')
    const hunkId = 'src/a.ts:1:1'
    expect(await s.decideHunk('session-1', hunkId, 'accept')).toBe(true)
    expect((await s.hunksFor('session-1'))?.decisionFor(hunkId)).toBe('accept')
    expect(set?.byFile()[0].accepted).toEqual([hunkId])
  })

  it('keeps decisions across reads, so scrolling away does not lose them', async () => {
    const s = withPatch()
    addRun(s)
    await s.hunksFor('session-1')
    const hunkId = 'src/a.ts:1:1'
    await s.decideHunk('session-1', hunkId, 'reject')
    expect((await s.hunksFor('session-1'))?.decisionFor(hunkId)).toBe('reject')
  })

  it('is not complete until every hunk is decided', async () => {
    const s = withPatch()
    addRun(s)
    await s.hunksFor('session-1')
    await s.decideHunk('session-1', 'src/a.ts:1:1', 'accept')
    expect((await s.hunksFor('session-1'))?.isComplete()).toBe(false)
  })

  it('notices when everything was rejected — the branch keeps nothing', async () => {
    const s = withPatch()
    addRun(s)
    await s.hunksFor('session-1')
    for (const hunkId of ['src/a.ts:1:1', 'src/a.ts:11:2']) {
      await s.decideHunk('session-1', hunkId, 'reject')
    }
    expect((await s.hunksFor('session-1'))?.isFullReject()).toBe(true)
  })

  it('reports nothing for a run it does not have', async () => {
    expect(await build().hunksFor('nobody')).toBeNull()
    expect(await build().decideHunk('nobody', 'h1', 'accept')).toBe(false)
  })
})

describe('how it reaches git', () => {
  it('goes through the extension shell when nothing else is injected', async () => {
    // `api.shell.exec` is restricted to git and gh, which is exactly the reach
    // this needs and no more.
    const calls: Array<{ command: string; args: string[] }> = []
    const s = createSupervision({
      api: {
        shell: {
          exec: async ({ command, args }: { command: string; args: string[] }) => {
            calls.push({ command, args })
            return { exitCode: 0, stdout: '' }
          },
        },
      } as never,
      stateDir: dir,
    })
    addRun(s)
    await s.measure('session-1')
    expect(calls[0]).toMatchObject({ command: 'git' })
  })

  it('measures against the branch it was told to', async () => {
    const calls: string[][] = []
    const s = build({
      baseBranch: 'develop',
      run: async (_command, args) => {
        calls.push(args)
        return { ok: true, stdout: '' }
      },
    })
    addRun(s)
    await s.measure('session-1')
    expect(calls[0]).toContain('develop')
  })

  it('measures nothing for a run with no working copy', async () => {
    const calls: string[][] = []
    const s = build({
      run: async (_command, args) => {
        calls.push(args)
        return { ok: true, stdout: '' }
      },
    })
    s.runs.add({
      sessionId: 'no-copy',
      featureDir: '/repo/specs/021-a',
      phase: 'implement',
      worktreePath: '',
      branch: 'feat/a',
      terminalSessionId: 't',
      transcriptPath: '/t.jsonl',
      startedAt: 0,
    })
    await s.measure('no-copy')
    expect(calls).toEqual([])
  })

  it('ignores a measurement for a run it does not have', async () => {
    await expect(build().measure('nobody')).resolves.toBeUndefined()
  })

  it('refuses at the limit it was given rather than the default', async () => {
    const s = build({ reviewLimit: 1 })
    addRun(s)
    await s.finishTurn('session-1', 1, 2_000)
    expect(s.backpressure.check().allowed).toBe(false)
  })

  it('does nothing for a turn finished by a run it does not have', async () => {
    await expect(build().finishTurn('nobody', 1, 2_000)).resolves.toBeUndefined()
  })

  it('does nothing for a run ending that it does not have', () => {
    expect(() => build().finish('nobody', 2_000)).not.toThrow()
  })
})

describe('the intent step', () => {
  // The step every diff viewer skips: what was asked for, against what the
  // agent says it did, with work outside the request called out.
  function withFiles(files: string[]): Supervision {
    return build({
      run: async (_command, args) => ({
        ok: true,
        stdout: args.includes('ls-files') ? '' : files.map((f) => `1\t0\t${f}`).join('\n'),
      }),
    })
  }

  it('reports what the agent touched against what it said', async () => {
    const s = withFiles(['src/a.ts'])
    addRun(s)
    const intent = await s.intentFor('session-1', 'Add a helper', 'Added the helper')
    expect(intent).toMatchObject({ request: 'Add a helper', agentAccount: 'Added the helper' })
  })

  it('names files the request never asked about — the scope-creep signal', async () => {
    const s = withFiles(['src/a.ts', 'src/config/timeouts.ts'])
    addRun(s)
    // The request names the file it is about; the agent also touched another.
    const intent = await s.intentFor('session-1', 'Add a helper to src/a.ts', 'Added it')
    expect(intent?.unexpectedFiles).toContain('src/config/timeouts.ts')
  })

  it('reports nothing for a run it does not have', async () => {
    expect(await build().intentFor('nobody', 'x', 'y')).toBeNull()
  })
})

describe('lanes across repositories', () => {
  const card = {
    id: 'FLU-220',
    lanes: [
      {
        ord: 1,
        repo: 'fluent',
        branch: 'feat/x',
        role: 'producer' as const,
        blocks: [2],
        blocked_by: [],
      },
      {
        ord: 2,
        repo: 'cli',
        branch: 'feat/x',
        role: 'consumer' as const,
        blocks: [],
        blocked_by: [1],
      },
    ],
    contract: { shared_files: ['proto/session.proto'] },
  }

  it('orders them, so a consumer is never merged before its producer', () => {
    const s = build()
    expect(s.lanes(card).map((v) => v.lane.ord)).toEqual([1, 2])
  })

  it('flags the file both lanes touch, before either starts', () => {
    const s = build()
    expect(s.lanes(card)[0].collisions).toContain('proto/session.proto')
  })

  it('refuses a consumer while its producer is unmerged', () => {
    expect(build().mayMerge(card, 2, []).allowed).toBe(false)
  })

  it('allows it once the producer has merged', () => {
    expect(build().mayMerge(card, 2, [1]).allowed).toBe(true)
  })

  it('allows the producer straight away', () => {
    expect(build().mayMerge(card, 1, []).allowed).toBe(true)
  })

  it('costs a single-lane card nothing', () => {
    // Every rule collapses to a no-op, so ordinary work never sees any of this.
    const single = {
      id: 'X',
      lanes: [{ ord: 1, repo: 'r', branch: 'b', blocks: [], blocked_by: [] }],
    }
    const s = build()
    expect(s.lanes(single)[0].collisions).toEqual([])
    expect(s.mayMerge(single, 1, []).allowed).toBe(true)
  })

  it('names lanes that started before their upstream merged', () => {
    // They are working against a contract that has since changed.
    const started = new Map([
      [1, 0],
      [2, 1_000],
    ])
    expect(build().staleLanes(card, 1, 5_000, started)).toContain(2)
  })
})

describe('an unattended merge', () => {
  it('is refused unless the repository opted in', () => {
    const s = build()
    const decision = s.mergePolicy.mayMergeUnattended({
      sessionId: 'session-1',
      repoPath: '/wt/a',
      branch: 'feat/a',
      grade: 'P3',
      checkState: 'passing',
      diffSummary: { files: 1, added: 1, removed: 0 },
    })
    // The one action that happens with nobody watching, so it is not a default.
    // Note this is the merge *policy*'s decision, which says `may`; lane
    // ordering has its own shape that says `allowed`.
    expect(decision.may).toBe(false)
  })

  it('records what merged without a person, for reviewing after the fact', () => {
    const s = build()
    s.mergePolicy.recordUnattendedMerge(
      {
        sessionId: 'session-1',
        repoPath: '/wt/a',
        branch: 'feat/a',
        grade: 'P3',
        checkState: 'passing',
        diffSummary: { files: 1, added: 1, removed: 0 },
      },
      9_000
    )
    expect(s.mergePolicy.unattendedMerges()).toHaveLength(1)
  })
})
