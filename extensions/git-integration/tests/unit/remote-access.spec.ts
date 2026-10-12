import { describe, it, expect, vi } from 'vitest'
import type { ExtensionAPI } from '@terminator/extension-sdk'

vi.mock('electron-store', () => ({
  default: class {
    store = {}
    get() {
      return undefined
    }
    set() {}
    delete() {}
  },
}))

import { activate, deactivate } from '../../src/index.ts'

function activateCapturingRemoteChannels(): string[] {
  const remote: string[] = []
  const disposable = { dispose: () => {} }
  const api = {
    ipc: {
      registerHandler: (
        channel: string,
        _handler: unknown,
        opts?: { remoteAccessible?: boolean }
      ) => {
        if (opts?.remoteAccessible === true) remote.push(channel)
        return disposable
      },
    },
    settings: { get: () => undefined, register: () => disposable, isBranchExcluded: () => false },
    commands: { register: () => disposable },
    window: { broadcast: () => {}, openAuxiliary: () => {} },
    nativeMenu: { addViewMenuItem: () => disposable },
    topBar: { registerMenuItem: () => disposable },
    notifications: { showToast: () => {}, createNotification: () => disposable },
    workspace: { list: () => [], listProjects: () => [] },
    shell: { exec: vi.fn() },
    github: {},
  } as unknown as ExtensionAPI
  activate(api)
  deactivate()
  return remote
}

describe('the remote browser client', () => {
  // A logged-in remote browser reaches only what is opted in (ADR 094); a
  // channel added here is a decision, so the list is spelled out.
  it('may call exactly these read-only channels, and nothing that writes or runs', () => {
    expect(activateCapturingRemoteChannels().sort()).toEqual([
      'git:conflicts-list',
      'git:pr-status',
      'git:status',
      'github:accessible-repos',
      'github:active-reviews-for-repo',
      'github:current-user',
      'github:dashboard-search',
      'github:list-open-prs',
      'github:pr-compare',
      'github:pr-inline-comments',
      'github:pr-issue-comments',
      'github:pr-review-detail',
      'github:review-settings',
      'github:session-get',
      'github:sessions-for-repo',
      'review-agent:list',
      'review-agent:settings',
    ])
  })
})
