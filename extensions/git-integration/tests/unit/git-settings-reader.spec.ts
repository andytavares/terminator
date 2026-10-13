import { describe, it, expect } from 'vitest'
import type { ExtensionAPI, SettingScope } from '@terminator/extension-sdk'
import { gitSettings } from '../../src/git-settings'
import { partialFake } from '../../../../tests/support/fakes'

/**
 * The settings reader over stored values, as the settings page writes them:
 * `ownValues` by workspace folder, read for a repository there, else `stored`.
 */
function readerOver(
  stored: Record<string, unknown>,
  ownValues: Record<string, Record<string, unknown>> = {}
) {
  const settings = partialFake<ExtensionAPI['settings']>({
    get: <T>(key: string, scope?: SettingScope) =>
      (ownValues[scope?.repoPath ?? '']?.[key] ?? stored[key]) as T | undefined,
  })
  return gitSettings(partialFake<ExtensionAPI>({ settings }))
}

const MAX = 'terminator.git-integration.git.maxDisplayedFiles'
const SIGN_OFF = 'terminator.git-integration.git.commit.signOff'

describe('gitSettings', () => {
  it('reads a sign-off switched on, and anything else as off', () => {
    expect(readerOver({ [SIGN_OFF]: true }).signOff('/code/api')).toBe(true)
    expect(readerOver({ [SIGN_OFF]: false }).signOff('/code/api')).toBe(false)
    expect(readerOver({}).signOff('/code/api')).toBe(false)
  })

  it("reads sign-off for the repository's workspace: its own value, else the global one", () => {
    const reader = readerOver({ [SIGN_OFF]: false }, { '/code/api': { [SIGN_OFF]: true } })

    expect(reader.signOff('/code/api')).toBe(true)
    expect(reader.signOff('/code/web')).toBe(false)
  })

  it('keeps the file limit within the 10 to 5000 the setting declares', () => {
    expect(readerOver({ [MAX]: 3 }).maxDisplayedFiles()).toBe(10)
    expect(readerOver({ [MAX]: 90000 }).maxDisplayedFiles()).toBe(5000)
    expect(readerOver({ [MAX]: 42 }).maxDisplayedFiles()).toBe(42)
  })

  it('falls back to 500 when the field was left empty or unreadable', () => {
    expect(readerOver({ [MAX]: '' }).maxDisplayedFiles()).toBe(500)
    expect(readerOver({ [MAX]: 'many' }).maxDisplayedFiles()).toBe(500)
    expect(readerOver({}).maxDisplayedFiles()).toBe(500)
  })
})
