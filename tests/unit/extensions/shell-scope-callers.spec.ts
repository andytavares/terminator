import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { dispatchChannel, type ChannelSpec, type ExtensionAPI } from '@terminator/extension-sdk'
import { FakeBackendHost } from './fake-backend-host'

// Every legitimate caller ADR-006's workspace-only rule would have refused, run
// with the cwd its real code computes, through the real check (ADR 102): the
// built-in extensions are loaded from their own manifests, and git and gh are
// stand-ins on PATH that record where they ran.

vi.mock('electron', () => ({
  app: { getPath: () => tmpdir(), getVersion: () => '0.1.0' },
}))

const storeData: Record<string, unknown> = { extensions: [] }
vi.mock('electron-store', () => ({
  default: class MockStore {
    store: Record<string, unknown> = {}
    onDidAnyChange() {
      return () => {}
    }
    get(key: string) {
      return storeData[key]
    }
    set(key: string, value: unknown) {
      storeData[key] = value
    }
  },
}))

const settings: Record<string, unknown> = {}
vi.mock('../../../src/main/storage/extension-settings-store', () => ({
  getExtensionSetting: (key: string) => settings[key],
  setExtensionSetting: (key: string, value: unknown) => {
    settings[key] = value
  },
  getAllExtensionSettings: () => ({ ...settings }),
}))

const workspaces: Array<{ id: string; name: string; folderPath: string }> = []
const projects: Array<{ id: string; workspaceId: string; name: string; worktreePath?: string }> = []
vi.mock('../../../src/main/storage/workspace-store', () => ({
  listWorkspaces: () => workspaces,
  listProjects: (workspaceId: string) => projects.filter((p) => p.workspaceId === workspaceId),
}))

const BUILT_IN = resolve(__dirname, '../../../extensions')
const originalPath = process.env.PATH
let scratch: string
let userData: string
let ran: string

function directory(...parts: string[]): string {
  const path = join(scratch, ...parts)
  mkdirSync(path, { recursive: true })
  return path
}

/** A stand-in that records the directory it ran in and prints `out` (empty when absent). */
function standIn(bin: string, name: string): void {
  const script = join(bin, name)
  writeFileSync(script, `#!/bin/sh\npwd >> "${ran}"\ncat "${scratch}/out" 2>/dev/null\nexit 0\n`)
  chmodSync(script, 0o755)
}

const ranIn = () => readFileSync(ran, 'utf8').trim().split('\n')

async function builtIn(name: string, id: string): Promise<ExtensionAPI> {
  const { ExtensionHost } = await import('../../../src/main/extensions/extension-host')
  const host = new ExtensionHost(new FakeBackendHost())
  host.setDeps({ paths: { app: directory('app'), userData } })
  await host.load(join(BUILT_IN, name))
  return host.hostedApi(id)!
}

const gitIn = (api: ExtensionAPI, cwd: string) =>
  api.shell.exec({ command: 'git', args: ['status'], cwd })

beforeEach(() => {
  vi.resetModules()
  storeData.extensions = []
  workspaces.length = 0
  projects.length = 0
  for (const key of Object.keys(settings)) delete settings[key]
  scratch = realpathSync(mkdtempSync(join(tmpdir(), 'shell-callers-')))
  userData = directory('user-data')
  ran = join(scratch, 'ran.log')
  const bin = directory('bin')
  standIn(bin, 'git')
  standIn(bin, 'gh')
  process.env.PATH = `${bin}:${originalPath}`
})

afterEach(() => {
  process.env.PATH = originalPath
  rmSync(scratch, { recursive: true, force: true })
})

describe('a project worktree under git.worktreeBaseDir, outside the workspace folder', () => {
  it('runs git in it once it is a project', async () => {
    const { suggestWorktreePath } = await import('../../../src/main/git/git-service')
    const repo = directory('code', 'widgets')
    const worktree = suggestWorktreePath(repo, 'feature/login', directory('worktrees'))
    mkdirSync(worktree)
    workspaces.push({ id: 'w1', name: 'Widgets', folderPath: repo })
    projects.push({ id: 'p1', workspaceId: 'w1', name: 'login', worktreePath: worktree })
    const api = await builtIn('foundry', 'terminator.foundry')

    expect((await gitIn(api, worktree)).exitCode).toBe(0)
    expect(ranIn()).toEqual([worktree])
  })
})

describe('Foundry', () => {
  async function foundry(): Promise<ExtensionAPI> {
    const api = await builtIn('foundry', 'terminator.foundry')
    const { registerSettings } = await import(
      '../../../extensions/foundry/src/state/settings-schema'
    )
    registerSettings(api)
    return api
  }

  async function lanePath(api: ExtensionAPI): Promise<{ root: string; lane: string }> {
    const { resolveFoundryDataRoot } = await import(
      '../../../extensions/foundry/src/workspace-root'
    )
    const { checkoutPath } = await import('../../../extensions/foundry/src/line/worktree')
    const root = resolveFoundryDataRoot(api)
    const lane = checkoutPath(root, { id: 'WO-1' } as Parameters<typeof checkoutPath>[1], 'widgets')
    mkdirSync(lane, { recursive: true })
    return { root, lane }
  }

  it('runs git in its records root in api.paths.globalStorage, and in a lane there, with no workspace open', async () => {
    const api = await foundry()
    const { root, lane } = await lanePath(api)

    expect(root.startsWith(join(userData, 'extensions', 'terminator.foundry'))).toBe(true)
    expect((await gitIn(api, root)).exitCode).toBe(0)
    expect((await gitIn(api, lane)).exitCode).toBe(0)
    expect(ranIn()).toEqual([root, lane])
  })

  it('runs git in terminator.foundry.dataDir set to an absolute path, and in a lane there', async () => {
    workspaces.push({ id: 'w1', name: 'Widgets', folderPath: directory('code', 'widgets') })
    settings['terminator.foundry.dataDir'] = directory('foundry-records')
    const api = await foundry()
    const { root, lane } = await lanePath(api)

    expect(root).toBe(join(scratch, 'foundry-records'))
    expect((await gitIn(api, root)).exitCode).toBe(0)
    expect((await gitIn(api, lane)).exitCode).toBe(0)
    expect(ranIn()).toEqual([root, lane])
  })
})

describe('git-integration', () => {
  const CLONE_FOLDER = 'terminator.git-integration.review.cloneFolder'

  async function githubChannels(): Promise<Record<string, (payload: unknown) => Promise<unknown>>> {
    const api = await builtIn('git-integration', 'terminator.git-integration')
    // The one property of the extension's settings page this caller depends on.
    api.settings.register({
      label: 'Git',
      properties: { [CLONE_FOLDER]: { type: 'folder', label: 'Clone folder', default: '' } },
    })
    const { registerGithubHandlers } = await import(
      '../../../extensions/git-integration/src/ipc/github.ipc'
    )
    const channels: Record<string, (payload: unknown) => Promise<unknown>> = {}
    mkdirSync(api.paths.globalStorage, { recursive: true })
    const access = {
      github: api.github,
      getToken: () => '',
      noCheckoutCwd: api.paths.globalStorage,
    }
    registerGithubHandlers((spec: ChannelSpec) => {
      channels[spec.channel] = (payload) => dispatchChannel(spec, payload)
    }, access)
    return channels
  }

  it('clones into the review clone folder it declares', async () => {
    const clones = directory('reviews')
    settings[CLONE_FOLDER] = clones
    const channels = await githubChannels()

    const result = await channels['github:clone-repo']({ repo: 'acme/widgets', folder: clones })

    expect(result).toEqual({ repoRoot: join(clones, 'widgets') })
    expect(ranIn()).toEqual([clones])
  })

  it('runs gh with no checkout in api.paths.globalStorage: a gh: root, the repositories, the dashboard', async () => {
    writeFileSync(join(scratch, 'out'), '')
    const channels = await githubChannels()

    await expect(
      channels['github:pr-mark-ready']({ repoRoot: 'gh:acme/widgets', prNumber: 7 })
    ).resolves.toEqual({ ok: true })
    await expect(channels['github:accessible-repos']({ refresh: true })).resolves.toEqual({
      repos: [],
    })
    await channels['github:dashboard-search']({})

    expect(new Set(ranIn())).toEqual(
      new Set([join(userData, 'extensions', 'terminator.git-integration')])
    )
  })
})
