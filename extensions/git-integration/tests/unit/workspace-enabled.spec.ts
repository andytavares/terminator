import { describe, it, expect } from 'vitest'
import { dispatchChannel } from '@terminator/extension-sdk'
import { activateInWorkspaces, type FakeWorkspace } from './support/activate'
import { makeTempDir } from '../../../../tests/support/temp-dir'

// "Enable Git Integration" is workspace-scoped: a workspace may switch it off for its own
// repositories, or on while it is off globally. Switched off, a channel answers GIT_DISABLED and
// runs no git.

const ENABLED = 'terminator.git-integration.git.enabled'

function workspaceSetting(enabled?: boolean): FakeWorkspace {
  const folderPath = makeTempDir('git-enabled-')
  const settings = enabled === undefined ? undefined : { [ENABLED]: enabled }
  return { folderPath, worktreePaths: [folderPath], settings }
}

function statusChannel(channels: ReturnType<typeof activateInWorkspaces>['channels']) {
  return channels.find((c) => c.spec.channel === 'git:status')!.spec
}

describe('"Enable Git Integration" per workspace', () => {
  it('answers GIT_DISABLED, running no git, for a repository in a workspace that switched it off', async () => {
    const off = workspaceSetting(false)
    const inherits = workspaceSetting()
    const { channels, exec } = activateInWorkspaces([off, inherits])
    const status = statusChannel(channels)

    await expect(dispatchChannel(status, { path: off.folderPath })).resolves.toEqual({
      error: 'GIT_DISABLED',
    })
    expect(exec).not.toHaveBeenCalled()

    await dispatchChannel(status, { path: inherits.folderPath })
    expect(exec).toHaveBeenCalled()
  })
})

describe('"Enable Git Integration" off globally', () => {
  it('activates while off globally when a workspace switches it on, and only that workspace runs git', async () => {
    const on = workspaceSetting(true)
    const inherits = workspaceSetting()
    const { channels, exec } = activateInWorkspaces([on, inherits], { [ENABLED]: false })
    const status = statusChannel(channels)

    await expect(dispatchChannel(status, { path: inherits.folderPath })).resolves.toEqual({
      error: 'GIT_DISABLED',
    })
    expect(exec).not.toHaveBeenCalled()

    await dispatchChannel(status, { path: on.folderPath })
    expect(exec).toHaveBeenCalled()
  })

  it('registers nothing but its settings page when it is off globally and in every workspace', () => {
    const { channels } = activateInWorkspaces([workspaceSetting(false), workspaceSetting()], {
      [ENABLED]: false,
    })

    expect(channels).toEqual([])
  })
})
