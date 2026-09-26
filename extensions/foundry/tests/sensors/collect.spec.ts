import { describe, it, expect, vi } from 'vitest'
import { collect } from '../../src/sensors/collect.js'
import type { CollectDeps } from '../../src/sensors/collect.js'
import type { ExecResult, ShellExec } from '../../src/line/integrate.js'
import type { SensorSource } from '../../src/sensors/types.js'

// Collectors turn one sensor source into sensed items, or a one-sentence
// problem when the command they depend on fails. They never throw: a bad
// `gh` call is a signal about the environment, not the sensor's own bug.

function ok(stdout: string): ExecResult {
  return { exitCode: 0, stdout, stderr: '', timedOut: false }
}

function fail(stderr: string): ExecResult {
  return { exitCode: 1, stdout: '', stderr, timedOut: false }
}

/** A fake exec that replays a fixed queue of results, one per call. */
function queuedExec(results: ExecResult[]): ShellExec {
  const calls = [...results]
  return vi.fn(async () => {
    const next = calls.shift()
    if (!next) throw new Error('exec queue exhausted')
    return next
  })
}

function deps(over: Partial<CollectDeps> = {}): CollectDeps {
  return {
    exec: queuedExec([]),
    cwd: '/repos/app',
    issues: null,
    now: () => '2026-09-26T00:00:00.000Z',
    ...over,
  }
}

describe('collect: github-runs', () => {
  const source: SensorSource = { kind: 'github-runs', branch: 'main', limit: 5 }

  it('maps failed runs to one item each, keyed by workflow', async () => {
    const runs = [
      {
        databaseId: 1,
        displayTitle: 'fix: flaky test',
        headSha: 'abc123',
        workflowName: 'CI',
        createdAt: '2026-09-25T10:00:00.000Z',
        url: 'https://github.com/o/r/actions/runs/1',
      },
      {
        databaseId: 2,
        displayTitle: 'chore: bump deps',
        headSha: 'def456',
        workflowName: 'Lint',
        createdAt: '2026-09-25T11:00:00.000Z',
        url: 'https://github.com/o/r/actions/runs/2',
      },
    ]
    const exec = queuedExec([ok(JSON.stringify(runs))])
    const result = await collect(source, deps({ exec }))

    expect(result.problem).toBeNull()
    expect(result.items).toHaveLength(2)
    expect(result.items[0]).toEqual({
      key: 'workflow:CI',
      title: 'CI failing on main',
      evidence: {
        kind: 'ci-run',
        title: 'fix: flaky test',
        url: 'https://github.com/o/r/actions/runs/1',
        at: '2026-09-25T10:00:00.000Z',
      },
    })
    expect(result.items[1].key).toBe('workflow:Lint')

    expect(exec).toHaveBeenCalledWith(
      expect.objectContaining({
        command: 'gh',
        args: [
          'run',
          'list',
          '--branch',
          'main',
          '--status',
          'failure',
          '--limit',
          '5',
          '--json',
          'databaseId,displayTitle,headSha,workflowName,createdAt,url',
        ],
        cwd: '/repos/app',
      })
    )
  })

  it('resolves the default branch first when branch is null', async () => {
    const exec = queuedExec([ok('main\n'), ok('[]')])
    const source: SensorSource = { kind: 'github-runs', branch: null, limit: 10 }

    const result = await collect(source, deps({ exec }))

    expect(result.problem).toBeNull()
    expect(exec).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        command: 'gh',
        args: ['repo', 'view', '--json', 'defaultBranchRef', '--jq', '.defaultBranchRef.name'],
        cwd: '/repos/app',
      })
    )
    expect(exec).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        args: expect.arrayContaining(['--branch', 'main']),
      })
    )
  })

  it('reports a problem naming the command when gh fails, never throws', async () => {
    const exec = queuedExec([fail('gh: authentication required')])

    const result = await collect(source, deps({ exec }))

    expect(result.items).toEqual([])
    expect(result.problem).toMatch(/gh run list/)
  })

  it('reports a problem when the default-branch lookup fails', async () => {
    const exec = queuedExec([fail('gh: not a git repository')])
    const nullBranchSource: SensorSource = { kind: 'github-runs', branch: null, limit: 5 }

    const result = await collect(nullBranchSource, deps({ exec }))

    expect(result.items).toEqual([])
    expect(result.problem).toMatch(/default branch/)
    expect(exec).toHaveBeenCalledTimes(1)
  })

  it('reports a problem when gh run list returns output that does not parse', async () => {
    const exec = queuedExec([ok('not json')])

    const result = await collect(source, deps({ exec }))

    expect(result.items).toEqual([])
    expect(result.problem).toMatch(/could not be read/)
  })
})

describe('collect: github-issues', () => {
  const source: SensorSource = { kind: 'github-issues', label: 'bug', limit: 20 }

  it('normalises titles with digits and paths into one shared key', async () => {
    const issues = [
      {
        number: 42,
        title: 'Crash in /api/42',
        url: 'https://github.com/o/r/issues/42',
        updatedAt: 't1',
      },
      {
        number: 77,
        title: 'Crash in /api/77',
        url: 'https://github.com/o/r/issues/77',
        updatedAt: 't2',
      },
    ]
    const exec = queuedExec([ok(JSON.stringify(issues))])

    const result = await collect(source, deps({ exec }))

    expect(result.problem).toBeNull()
    expect(result.items).toHaveLength(2)
    expect(result.items[0].key).toBe(result.items[1].key)
    expect(result.items[0].key).toMatch(/^issue:bug:/)
    expect(result.items[0].evidence.kind).toBe('issue')

    expect(exec).toHaveBeenCalledWith(
      expect.objectContaining({
        command: 'gh',
        args: [
          'issue',
          'list',
          '--label',
          'bug',
          '--state',
          'open',
          '--limit',
          '20',
          '--json',
          'number,title,url,updatedAt',
        ],
        cwd: '/repos/app',
      })
    )
  })

  it('reports a problem naming the command when gh fails, never throws', async () => {
    const exec = queuedExec([fail('gh: rate limited')])

    const result = await collect(source, deps({ exec }))

    expect(result.items).toEqual([])
    expect(result.problem).toMatch(/gh issue list/)
  })

  it('reports a problem when gh issue list returns output that does not parse', async () => {
    const exec = queuedExec([ok('not json')])

    const result = await collect(source, deps({ exec }))

    expect(result.items).toEqual([])
    expect(result.problem).toMatch(/could not be read/)
  })
})

describe('collect: tracker', () => {
  const search = vi.fn()
  const listMine = vi.fn()

  function trackerDeps(over: Partial<CollectDeps> = {}): CollectDeps {
    search.mockReset()
    listMine.mockReset()
    return deps({ issues: { search, listMine }, ...over })
  }

  it('searches when a query is set', async () => {
    const built = trackerDeps()
    search.mockResolvedValue([
      { key: 'PROJ-1', title: 'Login flakes', url: 'https://tracker/PROJ-1', updatedAt: 't1' },
    ])
    const source: SensorSource = { kind: 'tracker', query: 'flake', limit: 15 }

    const result = await collect(source, built)

    expect(search).toHaveBeenCalledWith('flake', { limit: 15 })
    expect(listMine).not.toHaveBeenCalled()
    expect(result.problem).toBeNull()
    expect(result.items[0].key).toMatch(/^tracker:/)
  })

  it('lists mine when the query is null', async () => {
    const built = trackerDeps()
    listMine.mockResolvedValue([])
    const source: SensorSource = { kind: 'tracker', query: null, limit: 15 }

    const result = await collect(source, built)

    expect(listMine).toHaveBeenCalledWith({ limit: 15 })
    expect(search).not.toHaveBeenCalled()
    expect(result.items).toEqual([])
    expect(result.problem).toBeNull()
  })

  it('gives a problem, not a throw, when no tracker is connected', async () => {
    const source: SensorSource = { kind: 'tracker', query: 'flake', limit: 15 }

    const result = await collect(source, deps({ issues: null }))

    expect(result.items).toEqual([])
    expect(result.problem).toBe('No tracker is connected.')
  })
})
