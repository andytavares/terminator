import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  chmodSync,
  existsSync,
  mkdirSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs'
import { join } from 'node:path'
import type { ExtensionAPI } from '@terminator/extension-sdk'
import { FakeBackendHost } from './fake-backend-host'
import { makeTempDir } from '../../support/temp-dir'

// api.shell.exec and api.github as an extension's calls reach them: through the
// extension host, with the manifest the extension shipped, the real cwd check and
// stand-in git and gh on PATH (ADR 102).

vi.mock('electron', () => ({
  // The logger writes terminator.log under logs; a spec scratch keeps it out of the temp root.
  app: { getPath: () => scratch, getVersion: () => '0.1.0' },
}))

const storeData: Record<string, unknown> = { extensions: [] }
vi.mock('electron-store', () => ({
  default: class MockStore {
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
  extensionSettingsSnapshot: () => ({ global: { ...settings }, workspaces: {} }),
}))

const workspaces: Array<{ id: string; name: string; folderPath: string }> = []
const projects: Array<{ id: string; workspaceId: string; name: string; worktreePath?: string }> = []
vi.mock('../../../src/main/storage/workspace-store', () => ({
  listWorkspaces: () => workspaces,
  listProjects: (workspaceId: string) => projects.filter((p) => p.workspaceId === workspaceId),
}))

const ID = 'com.example.tool'
const FOLDER_KEY = `${ID}.cloneFolder`

const originalPath = process.env.PATH
let scratch: string
let ran: string

function directory(...parts: string[]): string {
  const path = join(scratch, ...parts)
  mkdirSync(path, { recursive: true })
  return path
}

/** A stand-in for `name` that records the directory it ran in, then prints it. */
function standIn(bin: string, name: string): void {
  const script = join(bin, name)
  writeFileSync(script, `#!/bin/sh\npwd >> "${ran}"\npwd\n`)
  chmodSync(script, 0o755)
}

async function hostedApi(contributes: Record<string, unknown> = {}): Promise<ExtensionAPI> {
  const { ExtensionHost } = await import('../../../src/main/extensions/extension-host')
  const host = new ExtensionHost(new FakeBackendHost())
  host.setDeps({ paths: { app: directory('app'), userData: directory('user-data') } })
  const extension = directory('extensions', ID)
  const manifest = { id: ID, name: 'Tool', version: '1.0.0', description: 'Test', main: 'main.js' }
  writeFileSync(
    join(extension, 'manifest.json'),
    JSON.stringify({ ...manifest, minAppVersion: '0.0.1', contributes })
  )
  await host.load(extension)
  return host.apiOf(ID)!
}

function registerFolderSetting(api: ExtensionAPI, type: 'folder' | 'string' = 'folder'): void {
  api.settings.register({
    label: 'Tool',
    properties: { [FOLDER_KEY]: { type, label: 'Clone', default: '' } },
  })
}

const gitIn = (api: ExtensionAPI, cwd: string) =>
  api.shell.exec({ command: 'git', args: ['status'], cwd })

beforeEach(() => {
  vi.resetModules()
  storeData.extensions = []
  workspaces.length = 0
  projects.length = 0
  for (const key of Object.keys(settings)) delete settings[key]
  scratch = realpathSync(makeTempDir('shell-scope-'))
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

describe('api.shell.exec runs only inside a root', () => {
  it('runs in a workspace folder and in a project worktree outside it', async () => {
    const folder = directory('repo')
    const worktree = directory('worktrees', 'repo-feature')
    workspaces.push({ id: 'w1', name: 'Repo', folderPath: folder })
    projects.push({ id: 'p1', workspaceId: 'w1', name: 'feature', worktreePath: worktree })
    const api = await hostedApi()

    expect((await gitIn(api, join(folder))).stdout).toBe(`${folder}\n`)
    expect((await gitIn(api, worktree)).stdout).toBe(`${worktree}\n`)
  })

  it('runs in its own api.paths.globalStorage, <userData>/extensions/<id>', async () => {
    const api = await hostedApi()

    expect(api.paths.globalStorage).toBe(join(scratch, 'user-data', 'extensions', ID))
    const records = directory('user-data', 'extensions', ID, 'records')
    expect((await gitIn(api, records)).stdout).toBe(`${records}\n`)
  })
})

describe('api.shell.exec runs only inside a root — other folders and settings', () => {
  it("refuses another extension's folder, and userData outside its own folder", async () => {
    const api = await hostedApi()
    const other = directory('user-data', 'extensions', 'com.example.other', 'records')

    for (const cwd of [other, join(scratch, 'user-data'), directory('user-data', 'foundry')]) {
      await expect(gitIn(api, cwd)).rejects.toMatchObject({ name: 'CwdOutOfScopeError' })
    }
    expect(existsSync(ran)).toBe(false)
  })

  it('runs in a declared folder setting, read when the call is made', async () => {
    const api = await hostedApi({ shellRoots: [FOLDER_KEY] })
    registerFolderSetting(api)
    const clones = directory('clones')
    settings[FOLDER_KEY] = clones

    expect((await gitIn(api, clones)).stdout).toBe(`${clones}\n`)
    settings[FOLDER_KEY] = directory('elsewhere')
    await expect(gitIn(api, clones)).rejects.toMatchObject({ name: 'CwdOutOfScopeError' })
  })
})

describe('api.shell.exec runs only inside a root — escapes', () => {
  it('refuses a directory outside every root, and runs nothing', async () => {
    workspaces.push({ id: 'w1', name: 'Repo', folderPath: directory('repo') })
    const api = await hostedApi()

    await expect(gitIn(api, directory('outside'))).rejects.toMatchObject({
      name: 'CwdOutOfScopeError',
      message: expect.stringContaining(join(scratch, 'outside')),
    })
    expect(existsSync(ran)).toBe(false)
  })

  it('refuses a `..` escape, a symlink escape and a sibling sharing the prefix', async () => {
    const folder = directory('repo')
    const outside = directory('outside')
    symlinkSync(outside, join(folder, 'escape'))
    workspaces.push({ id: 'w1', name: 'Repo', folderPath: folder })
    const api = await hostedApi()

    for (const cwd of [`${folder}/../outside`, join(folder, 'escape'), directory('repo-sibling')]) {
      await expect(gitIn(api, cwd)).rejects.toMatchObject({ name: 'CwdOutOfScopeError' })
    }
    expect(existsSync(ran)).toBe(false)
  })
})

describe('api.shell.exec runs only inside a root — undeclared folders', () => {
  it('ignores a declared key the extension never registered as a folder', async () => {
    const api = await hostedApi({ shellRoots: [FOLDER_KEY] })
    const clones = directory('clones')
    settings[FOLDER_KEY] = clones

    await expect(gitIn(api, clones)).rejects.toMatchObject({ name: 'CwdOutOfScopeError' })
    registerFolderSetting(api, 'string')
    await expect(gitIn(api, clones)).rejects.toMatchObject({ name: 'CwdOutOfScopeError' })
  })

  it('ignores a folder setting the manifest does not declare', async () => {
    const api = await hostedApi()
    registerFolderSetting(api)
    settings[FOLDER_KEY] = directory('clones')

    await expect(gitIn(api, join(scratch, 'clones'))).rejects.toMatchObject({
      name: 'CwdOutOfScopeError',
    })
  })
})

describe('api.github runs gh only inside a root', () => {
  it('runs gh in api.paths.globalStorage', async () => {
    const api = await hostedApi()
    const own = directory('user-data', 'extensions', ID)

    expect(await api.github.api({ cwd: own }, { path: 'user' })).toBe(`${own}\n`)
  })

  it('refuses gh in a directory outside every root, such as the home directory', async () => {
    const api = await hostedApi()

    await expect(
      api.github.api({ cwd: directory('home') }, { path: 'user' })
    ).rejects.toMatchObject({ name: 'CwdOutOfScopeError' })
    expect(existsSync(ran)).toBe(false)
  })
})
