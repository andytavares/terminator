import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { createProvisioner } from '../../../../../src/main/supervision/worktree/provisioner.js'
import type { SessionEvent } from '../../../../../src/main/supervision/events/session-event.js'

let root: string
let repoPath: string
let worktreeRoot: string

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'provisioner-'))
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

function harness() {
  const events: SessionEvent[] = []
  const git = {
    createWorktree: vi.fn(async (_repo: string, path: string) => {
      mkdirSync(path, { recursive: true })
    }),
    removeWorktree: vi.fn(async () => {}),
  }
  const provisioner = createProvisioner({
    git,
    isPortFree: () => true,
    activeSpans: () => [],
    publish: (e) => events.push(e),
    now: () => 1_000,
  })
  return { provisioner, git, events }
}

const request = () => ({
  sessionId: 's1',
  workItemId: 'FLU-220',
  repoPath,
  branch: 'feat/session-ulid',
  worktreeRoot,
})

describe('provisioning', () => {
  it('creates the worktree on its own branch', async () => {
    const { provisioner, git } = harness()
    const result = await provisioner.provision(request())
    expect(git.createWorktree).toHaveBeenCalledWith(
      repoPath,
      result.worktreePath,
      'feat/session-ulid',
      true
    )
  })

  it('names the worktree after the work item and branch, sanitised for the filesystem', async () => {
    const { provisioner } = harness()
    const result = await provisioner.provision(request())
    expect(result.worktreePath).toContain('FLU-220')
    expect(result.worktreePath).not.toContain('/feat/')
  })

  it('allocates a port span from the configured base', async () => {
    writeConfig({ worktree: { portBase: 5000, portSpan: 5 } })
    const { provisioner } = harness()
    await expect(provisioner.provision(request())).resolves.toMatchObject({
      ports: { portBase: 5000, portSpan: 5 },
    })
  })

  it('shares and copies what the config declares', async () => {
    mkdirSync(join(repoPath, 'node_modules'), { recursive: true })
    writeFileSync(join(repoPath, '.env.local'), 'TOKEN=1')
    writeConfig({ worktree: { symlink: ['node_modules'], copy: ['.env.local'] } })
    const { provisioner } = harness()
    const result = await provisioner.provision(request())
    expect(result.materialized.linked).toEqual(['node_modules'])
    expect(result.materialized.copied).toEqual(['.env.local'])
  })
})

describe('setup (FR-034)', () => {
  it('runs the declared setup command inside the worktree', async () => {
    writeConfig({ scripts: { setup: 'echo provisioned > marker.txt' } })
    const { provisioner } = harness()
    await expect(provisioner.provision(request())).resolves.toMatchObject({ ok: true })
  })

  it('reports failure, retains the output, and does not report ok', async () => {
    writeConfig({ scripts: { setup: 'echo breaking; exit 3' } })
    const { provisioner } = harness()
    const result = await provisioner.provision(request())
    expect(result.ok).toBe(false)
    expect(result.setup).toMatchObject({ exitCode: 3 })
    expect(result.setup?.output).toContain('breaking')
  })

  it('publishes setup_finished with the exit code, which is what marks the session failed', async () => {
    writeConfig({ scripts: { setup: 'exit 3' } })
    const { provisioner, events } = harness()
    await provisioner.provision(request())
    expect(events.at(-1)).toMatchObject({ kind: 'setup_finished', exitCode: 3 })
  })

  it('completes with no setup command at all, which is a valid configuration', async () => {
    const { provisioner, events } = harness()
    const result = await provisioner.provision(request())
    expect(result).toMatchObject({ ok: true, setup: null })
    expect(events.at(-1)).toMatchObject({ kind: 'setup_finished', exitCode: 0 })
  })

  it('exposes the allocated port base to the setup command', async () => {
    writeConfig({
      worktree: { portBase: 7000 },
      scripts: { setup: 'test "$TERMINATOR_PORT_BASE" = "7000"' },
    })
    const { provisioner } = harness()
    await expect(provisioner.provision(request())).resolves.toMatchObject({ ok: true })
  })
})

describe('release (FR-035)', () => {
  it('runs teardown then removes the worktree', async () => {
    writeConfig({ scripts: { teardown: 'exit 0' } })
    const { provisioner, git } = harness()
    const { worktreePath } = await provisioner.provision(request())
    const teardown = await provisioner.release({
      repoPath,
      worktreePath,
      workItemId: 'FLU-220',
      portBase: 4000,
    })
    expect(teardown).toMatchObject({ exitCode: 0 })
    expect(git.removeWorktree).toHaveBeenCalledWith(repoPath, worktreePath)
  })

  it('removes the worktree even when teardown fails, so broken checkouts do not pile up', async () => {
    writeConfig({ scripts: { teardown: 'exit 9' } })
    const { provisioner, git } = harness()
    const { worktreePath } = await provisioner.provision(request())
    const teardown = await provisioner.release({
      repoPath,
      worktreePath,
      workItemId: 'FLU-220',
      portBase: 4000,
    })
    expect(teardown).toMatchObject({ exitCode: 9 })
    expect(git.removeWorktree).toHaveBeenCalled()
  })

  it('removes the worktree when no teardown is declared', async () => {
    const { provisioner, git } = harness()
    const { worktreePath } = await provisioner.provision(request())
    await expect(
      provisioner.release({ repoPath, worktreePath, workItemId: 'FLU-220', portBase: 4000 })
    ).resolves.toBeNull()
    expect(git.removeWorktree).toHaveBeenCalled()
  })
})

describe('the branch the worktree is cut on', () => {
  it('cuts a new branch unless told otherwise, which is what an agent wants', async () => {
    const { provisioner, git } = harness()
    await provisioner.provision(request())
    expect(git.createWorktree.mock.calls[0][3]).toBe(true)
  })

  it('checks out an existing branch when the operator picked one', async () => {
    const { provisioner, git } = harness()
    await provisioner.provision({ ...request(), isNewBranch: false })
    // `git worktree add -b` on a branch that already exists fails.
    expect(git.createWorktree.mock.calls[0][3]).toBe(false)
  })
})
