import { describe, it, expect } from 'vitest'
import type { ExtensionAPI } from '@terminator/extension-sdk'
import { gitSettings } from '../../src/git-settings'
import { partialFake } from '../../../../tests/support/fakes'

/** The settings reader over stored values, as the settings page writes them. */
function readerOver(stored: Record<string, unknown>) {
  const settings = partialFake<ExtensionAPI['settings']>({
    get: <T>(key: string) => stored[key] as T | undefined,
  })
  return gitSettings(partialFake<ExtensionAPI>({ settings }))
}

const MAX = 'terminator.git-integration.git.maxDisplayedFiles'
const SIGN_OFF = 'terminator.git-integration.git.commit.signOff'

describe('gitSettings', () => {
  it('reads a sign-off switched on, and anything else as off', () => {
    expect(readerOver({ [SIGN_OFF]: true }).signOff()).toBe(true)
    expect(readerOver({ [SIGN_OFF]: false }).signOff()).toBe(false)
    expect(readerOver({}).signOff()).toBe(false)
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
