import { describe, it, expect, afterEach } from 'vitest'
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { dispatchChannel } from '@terminator/extension-sdk'
import { activateCapturingChannels, freshExtensionStorage } from './support/activate'

// git-integration keeps its stores in its own api.paths.globalStorage. Earlier
// builds kept them in the shared userData folder, so activation moves them.

// Every store the extension opens with namedStore.
const STORES = [
  'config.json',
  'pr-review-sessions.json',
  'pr-active-reviews.json',
  'pr-agent-reviews.json',
]

let globalStorage: string
const userData = () => dirname(dirname(globalStorage))

afterEach(() => {
  rmSync(userData(), { recursive: true, force: true })
})

describe('the stores move from userData into its own folder', () => {
  it('moves each store on the first activation', () => {
    globalStorage = freshExtensionStorage()
    for (const store of STORES) writeFileSync(join(userData(), store), `{"store":"${store}"}`)

    const { warn } = activateCapturingChannels(undefined, globalStorage)

    for (const store of STORES) {
      expect(readFileSync(join(globalStorage, store), 'utf8')).toBe(`{"store":"${store}"}`)
      expect(existsSync(join(userData(), store))).toBe(false)
    }
    expect(warn).not.toHaveBeenCalled()
  })

  it('keeps the store already in its folder, leaves the old copy, and says where it is', () => {
    globalStorage = freshExtensionStorage()
    mkdirSync(globalStorage, { recursive: true })
    writeFileSync(join(userData(), 'config.json'), '{"old":true}')
    writeFileSync(join(globalStorage, 'config.json'), '{"new":true}')

    const { warn } = activateCapturingChannels(undefined, globalStorage)

    expect(readFileSync(join(globalStorage, 'config.json'), 'utf8')).toBe('{"new":true}')
    expect(readFileSync(join(userData(), 'config.json'), 'utf8')).toBe('{"old":true}')
    expect(warn).toHaveBeenCalledWith(expect.stringContaining(join(userData(), 'config.json')))
  })
})

describe('gh that needs no checkout', () => {
  it('runs in its own folder, which activation creates', async () => {
    globalStorage = freshExtensionStorage()
    const { channels, githubApi } = activateCapturingChannels(undefined, globalStorage)
    const repos = channels.find((c) => c.spec.channel === 'github:accessible-repos')!.spec

    await dispatchChannel(repos, { refresh: true })

    expect(githubApi.mock.calls[0][0]).toMatchObject({ cwd: globalStorage })
    expect(existsSync(globalStorage)).toBe(true)
  })
})
