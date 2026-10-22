import { describe, it, expect, vi } from 'vitest'
import * as fs from 'node:fs'
import * as path from 'node:path'
import { profileKey, readProfile, writeProfile } from '../../src/profile/store.js'
import { emptyProfile } from '../../src/profile/schema.js'
import { connectIndexes } from '../../src/state/live-index.js'
import { temporaryDirectory } from '../helpers/foundry-host.js'
import { partialFake } from '../../../../tests/support/fakes'
import type { ExtensionAPI } from '@terminator/extension-sdk'

function announcingApi() {
  const broadcast = vi.fn()
  const api = partialFake<ExtensionAPI>({
    window: partialFake<ExtensionAPI['window']>({ broadcast }),
  })
  connectIndexes(api)
  return broadcast
}

describe('profile store', () => {
  it('round-trips a profile under <root>/profiles and announces it after writing', async () => {
    const root = temporaryDirectory('foundry-profiles')
    const repo = temporaryDirectory('foundry-profile-repo')
    const broadcast = announcingApi()
    const profile = {
      ...emptyProfile('repo'),
      prepare: { command: 'npm ci', source: 'operator' as const },
    }
    await writeProfile(root, repo, profile)
    expect(broadcast).toHaveBeenCalledWith('foundry:changed', { kind: 'profile', orderId: '' })
    expect(fs.existsSync(path.join(root, 'profiles', `${profileKey(repo)}.json`))).toBe(true)
    expect(await readProfile(root, repo)).toEqual(profile)
  })

  it('keys a symlinked checkout like its target', () => {
    const repo = temporaryDirectory('foundry-profile-repo')
    const link = path.join(temporaryDirectory('foundry-profile-link'), 'repo')
    fs.symlinkSync(repo, link)
    expect(profileKey(link)).toBe(profileKey(repo))
    expect(profileKey(repo)).toMatch(/^[A-Za-z0-9._-]+$/)
  })

  it('reads a missing or corrupt profile as none', async () => {
    const root = temporaryDirectory('foundry-profiles')
    const repo = temporaryDirectory('foundry-profile-repo')
    expect(await readProfile(root, repo)).toBeNull()
    fs.mkdirSync(path.join(root, 'profiles'))
    fs.writeFileSync(path.join(root, 'profiles', `${profileKey(repo)}.json`), '{{{')
    expect(await readProfile(root, repo)).toBeNull()
  })
})
