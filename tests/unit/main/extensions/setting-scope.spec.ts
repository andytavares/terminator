import { describe, it, expect } from 'vitest'
import { storedSettingValue, workspaceOwning } from '../../../../src/main/extensions/setting-scope'
import type { WorkspacesSnapshot } from '../../../../src/main/extensions/host/snapshot'

// A `workspaceScoped` extension setting resolves to the value the workspace
// owning the path sets for itself, else the global value. The default is the
// caller's: neither store holds it.

const KEY = 'terminator.git-integration.git.commit.signOff'

const workspaces: WorkspacesSnapshot = {
  workspaces: [
    { id: 'ws-api', name: 'API', folderPath: '/code/api' },
    { id: 'ws-web', name: 'Web', folderPath: '/code/web' },
  ],
  projects: {
    'ws-api': [{ id: 'p-1', workspaceId: 'ws-api', name: 'fix', worktreePath: '/wt/api-fix' }],
    'ws-web': [],
  },
}

const settings = {
  global: { [KEY]: false },
  workspaces: { 'ws-api': { 'terminator.git-integration': { [KEY]: true } } },
}

const readScopedSetting = (repoPath?: string) =>
  storedSettingValue(settings, workspaces, {
    extensionId: 'terminator.git-integration',
    key: KEY,
    repoPath,
  })

describe('workspaceOwning', () => {
  it('names the workspace whose folder holds the path, or one of whose project worktrees does', () => {
    expect(workspaceOwning('/code/api', workspaces)).toBe('ws-api')
    expect(workspaceOwning('/code/web/packages/ui', workspaces)).toBe('ws-web')
    expect(workspaceOwning('/wt/api-fix', workspaces)).toBe('ws-api')
  })

  it('names none for a path outside every workspace, a sibling with a shared prefix included', () => {
    expect(workspaceOwning('/elsewhere', workspaces)).toBeUndefined()
    expect(workspaceOwning('/code/api-old', workspaces)).toBeUndefined()
  })

  it('names the workspace for a folder inside it whose name starts with two dots', () => {
    expect(workspaceOwning('/code/api/..drafts', workspaces)).toBe('ws-api')
  })
})

describe('storedSettingValue', () => {
  it("reads the workspace's own value for a path in that workspace", () => {
    expect(readScopedSetting('/code/api')).toBe(true)
    expect(readScopedSetting('/wt/api-fix')).toBe(true)
  })

  it('reads the global value for a workspace that sets none, and with no path', () => {
    expect(readScopedSetting('/code/web')).toBe(false)
    expect(readScopedSetting()).toBe(false)
    expect(readScopedSetting('/elsewhere')).toBe(false)
  })

  it("never reads another extension's value under the same key", () => {
    const value = storedSettingValue(settings, workspaces, {
      extensionId: 'terminator.foundry',
      key: KEY,
      repoPath: '/code/api',
    })
    expect(value).toBe(false)
  })

  it('reads nothing when neither the workspace nor the global settings hold the key', () => {
    const empty = { global: {}, workspaces: {} }
    const value = storedSettingValue(empty, workspaces, {
      extensionId: 'terminator.git-integration',
      key: KEY,
      repoPath: '/code/api',
    })
    expect(value).toBeUndefined()
  })
})
