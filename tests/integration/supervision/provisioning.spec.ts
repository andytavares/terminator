import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, existsSync, lstatSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { execFileSync } from 'child_process'

// Git exports GIT_DIR, GIT_INDEX_FILE and friends into any process it spawns —
// including a hook — so a test that shells out to git inherits the *outer*
// repository's index and fails only when run from a commit hook. Scrub them.
const cleanEnv = (): NodeJS.ProcessEnv =>
  Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('GIT_')))

const git = (cwd: string, ...args: string[]): void => {
  execFileSync('git', args, { cwd, stdio: 'pipe', env: cleanEnv() })
}
import { createSupervisionService } from '../../../src/main/supervision/supervision-service.js'
import { rankAttention } from '../../../src/shared/supervision/rank-attention.js'

// SC-005, against a real git repository and a real setup script. The only
// thing faked is the agent runtime — provisioning itself is production code,
// because "usable with zero manual steps" is not a claim a mock can support.

let root: string
let repoPath: string
let worktreeRoot: string
let userDataPath: string

const built: Array<{ stop(): void }> = []

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'provisioning-'))
  repoPath = join(root, 'repo')
  worktreeRoot = join(root, 'wt')
  userDataPath = join(root, 'data')
  mkdirSync(repoPath, { recursive: true })
  mkdirSync(worktreeRoot, { recursive: true })
  mkdirSync(userDataPath, { recursive: true })

  git(repoPath, 'init', '--initial-branch=main')
  git(repoPath, 'config', 'user.email', 'test@example.com')
  git(repoPath, 'config', 'user.name', 'Test')
  writeFileSync(join(repoPath, 'README.md'), '# repo\n')
  git(repoPath, 'add', '.')
  git(repoPath, 'commit', '-m', 'initial')

  // The heavy directory that must be shared rather than copied, and the
  // gitignored file that must be carried across.
  mkdirSync(join(repoPath, 'node_modules', 'left-pad'), { recursive: true })
  writeFileSync(join(repoPath, 'node_modules', 'left-pad', 'index.js'), 'module.exports = 1\n')
  writeFileSync(join(repoPath, '.env.local'), 'TOKEN=secret\n')
})

afterEach(() => {
  while (built.length > 0) built.pop()?.stop()
  rmSync(root, { recursive: true, force: true })
})

function writeConfig(scripts: Record<string, string>): void {
  mkdirSync(join(repoPath, '.terminator'), { recursive: true })
  writeFileSync(
    join(repoPath, '.terminator', 'config.json'),
    JSON.stringify({
      worktree: { symlink: ['node_modules'], copy: ['.env.local'], portBase: 4000, portSpan: 10 },
      scripts,
    })
  )
}

function memoryStore() {
  let value: unknown
  return { get: () => value, set: (v: unknown) => (value = v) }
}

function build() {
  const service = createSupervisionService({
    userDataPath,
    registryStore: memoryStore(),
    shadowStore: { get: () => undefined, set: () => {} },
    git: {
      createWorktree: async (repo: string, path: string, branch: string) => {
        git(repo, 'worktree', 'add', '-b', branch, path)
      },
      removeWorktree: async (repo: string, path: string) => {
        git(repo, 'worktree', 'remove', '--force', path)
      },
    },
  })
  built.push(service)
  return service
}

const provision = (service: ReturnType<typeof build>, sessionId = 's1') =>
  service.provisioner.provision({
    sessionId,
    workItemId: 'FLU-220',
    repoPath,
    branch: `feat/${sessionId}`,
    worktreeRoot,
  })

describe('SC-005 — a fresh working copy is usable with no manual step', () => {
  it('runs the declared setup script and reports it succeeded', async () => {
    writeConfig({ setup: 'echo installed > setup-ran.txt' })
    const result = await provision(build())
    expect(result.ok).toBe(true)
    expect(result.setup?.exitCode).toBe(0)
    expect(existsSync(join(result.worktreePath, 'setup-ran.txt'))).toBe(true)
  })

  it('shares the heavy directory rather than copying it', async () => {
    writeConfig({})
    const result = await provision(build())
    // The one published fix for the top complaint in this category.
    expect(lstatSync(join(result.worktreePath, 'node_modules')).isSymbolicLink()).toBe(true)
    expect(existsSync(join(result.worktreePath, 'node_modules', 'left-pad', 'index.js'))).toBe(true)
  })

  it('carries the gitignored files the repository declared', async () => {
    writeConfig({})
    const result = await provision(build())
    expect(existsSync(join(result.worktreePath, '.env.local'))).toBe(true)
    expect(lstatSync(join(result.worktreePath, '.env.local')).isSymbolicLink()).toBe(false)
  })

  it('allocates a port range and hands it to the setup script', async () => {
    writeConfig({ setup: 'echo $TERMINATOR_PORT_BASE > ports.txt' })
    const result = await provision(build())
    expect(result.ports.portBase).toBeGreaterThan(0)
    expect(result.setup?.exitCode).toBe(0)
  })

  it('checks out the branch it was asked for', async () => {
    writeConfig({})
    const result = await provision(build())
    const branch = execFileSync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], {
      cwd: result.worktreePath,
      encoding: 'utf-8',
      env: cleanEnv(),
    }).trim()
    expect(branch).toBe('feat/s1')
  })
})

describe('SC-008 — two working copies of one repository never collide on ports', () => {
  it('gives the second copy a span that does not overlap the first', async () => {
    writeConfig({})
    const service = build()
    const first = await provision(service, 's1')
    const second = await provision(service, 's2')

    const firstEnd = first.ports.portBase + first.ports.portSpan
    const secondEnd = second.ports.portBase + second.ports.portSpan
    expect(first.ports.portBase < secondEnd && second.ports.portBase < firstEnd).toBe(false)
  })

  it('lets a released span be taken again', async () => {
    writeConfig({})
    const service = build()
    const first = await provision(service, 's1')
    await service.provisioner.release({
      repoPath,
      worktreePath: first.worktreePath,
      workItemId: 'FLU-220',
      portBase: first.ports.portBase,
    })
    const next = await provision(service, 's2')
    expect(next.ports.portBase).toBe(first.ports.portBase)
  })
})

describe('SC-005 — a provisioning failure is visible without opening the session', () => {
  it('fails the session and keeps the command output', async () => {
    writeConfig({ setup: 'echo "lockfile is out of date" >&2; exit 3' })
    const service = build()
    service.registry.register('s1', {
      workItemId: null,
      laneOrd: null,
      repoPath,
      worktreePath: '',
      branch: 'feat/s1',
      autonomyLevel: 'edit',
    })

    const result = await provision(service)
    expect(result.ok).toBe(false)
    expect(result.setup?.exitCode).toBe(3)

    const session = service.getSession('s1')
    expect(session?.runtimeState).toBe('failed')
    // Visible on a listing surface without opening anything (FR-034).
    expect(session?.failure?.output).toContain('lockfile is out of date')
  })

  it('puts the failure on the attention queue, ranked', async () => {
    writeConfig({ setup: 'exit 1' })
    const service = build()
    service.registry.register('s1', {
      workItemId: null,
      laneOrd: null,
      repoPath,
      worktreePath: '',
      branch: 'feat/s1',
      autonomyLevel: 'edit',
    })
    await provision(service)

    const ranked = rankAttention(service.listSessions(), Date.now())
    expect(ranked.map((item) => item.reason)).toContain('failed')
  })

  it('starts no agent for a working copy that never became usable', async () => {
    writeConfig({ setup: 'exit 1' })
    const result = await provision(build())
    expect(result.ok).toBe(false)
  })
})
