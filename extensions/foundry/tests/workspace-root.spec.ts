import { describe, it, expect } from 'vitest'
import * as path from 'node:path'
import type { ExtensionAPI } from '@terminator/extension-sdk'
import { resolveFoundryDataRoot } from '../src/workspace-root.js'
import { partialFake } from '../../../tests/support/fakes'

// Every case names its own folders: the resolver memoises on the setting and
// the workspace, so two cases sharing both would read each other's answer.

interface HostShape {
  dataDir: string
  openFolders: () => { folderPath: string }[]
}

function workspaceHost({ dataDir, openFolders }: HostShape): ExtensionAPI {
  return partialFake<ExtensionAPI>({
    settings: partialFake<ExtensionAPI['settings']>({ get: <T>() => dataDir as T }),
    workspace: partialFake<ExtensionAPI['workspace']>({ list: openFolders as never }),
    paths: partialFake<ExtensionAPI['paths']>({ globalStorage: '/storage/foundry' }),
  })
}

describe('resolveFoundryDataRoot', () => {
  describe('with a workspace', withAWorkspaceTests)
  describe('when the workspace cannot be listed', unlistedWorkspaceTests)
})

function withAWorkspaceTests() {
  it('keeps the records beside the first workspace folder by default', () => {
    const api = workspaceHost({ dataDir: '', openFolders: () => [{ folderPath: '/work/default' }] })
    expect(resolveFoundryDataRoot(api)).toBe(path.join('/work/default', '.foundry'))
  })

  it('takes a configured absolute directory for every order', () => {
    const api = workspaceHost({
      dataDir: '/records/abs',
      openFolders: () => [{ folderPath: '/work/abs' }],
    })
    expect(resolveFoundryDataRoot(api)).toBe('/records/abs')
  })

  it('falls back to the default when the configured directory is relative', () => {
    const api = workspaceHost({
      dataDir: 'relative/records',
      openFolders: () => [{ folderPath: '/work/rel' }],
    })
    expect(resolveFoundryDataRoot(api)).toBe(path.join('/work/rel', '.foundry'))
  })
}

function unlistedWorkspaceTests() {
  it('keeps the configured directory when the workspace cannot be listed', () => {
    const api = workspaceHost({
      dataDir: '/records/no-workspace',
      openFolders: () => {
        throw new Error('no workspace service yet')
      },
    })
    expect(resolveFoundryDataRoot(api)).toBe('/records/no-workspace')
  })

  it('uses Foundry’s own storage when there is no workspace and nothing is configured', () => {
    const api = workspaceHost({
      dataDir: '',
      openFolders: () => {
        throw new Error('no workspace service yet')
      },
    })
    expect(resolveFoundryDataRoot(api)).toBe(path.join('/storage/foundry', 'records', '.foundry'))
  })
}
