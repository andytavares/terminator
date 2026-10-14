import { describe, it, expect, vi } from 'vitest'
import type { ExtensionAPI } from '@terminator/extension-sdk'

import { autonomyFor, letAutoModeDecide, lighterRedTeam } from '../../src/state/settings.js'
import { integrateDepsFor } from '../../src/line/ship-deps.js'
import { noteUntrackedDataRoot } from '../../src/workspace-root.js'
import { partialFake } from '../../../../tests/support/fakes'

// Each Foundry setting the operator changes, read where the Line, the Forge or
// activation reads it, with the value the operator chose rather than the default.

/** A host whose settings are `values`; what the extension writes lands there too. */
function host(values: Record<string, unknown>, showToast = vi.fn()): ExtensionAPI {
  const settings = partialFake<ExtensionAPI['settings']>({
    get: <T>(key: string) => values[key] as T,
    set: (key: string, value: unknown) => void (values[key] = value),
  })
  const notifications = partialFake<ExtensionAPI['notifications']>({ showToast })
  const paths = partialFake<ExtensionAPI['paths']>({ globalStorage: '/app-data/foundry' })
  return partialFake<ExtensionAPI>({ settings, notifications, paths })
}

describe('settings the operator changed', () => {
  it('Autonomy: escorted and lights-out are what the gates are given', () => {
    expect(autonomyFor(host({ 'terminator.foundry.autonomy': 'escorted' }))).toBe('escorted')
    expect(autonomyFor(host({ 'terminator.foundry.autonomy': 'lights-out' }))).toBe('lights-out')
  })

  it('Lighter red team: on puts the red team on the balanced model', () => {
    expect(lighterRedTeam(host({ 'terminator.foundry.lighterRedTeam': true }))).toBe(true)
  })

  it('Let auto mode decide: off leaves an undecided tool call to the operator', () => {
    expect(letAutoModeDecide(host({}))).toBe(true)
    expect(letAutoModeDecide(host({ 'terminator.foundry.letAutoModeDecide': false }))).toBe(false)
  })

  it('Open a draft pull request: off makes shipping wait for the operator', () => {
    expect(integrateDepsFor(host({}), '/records', 'o1').autoOpen).toBe(true)
    const off = host({ 'terminator.foundry.autoOpenDraftPr': false })
    expect(integrateDepsFor(off, '/records', 'o1').autoOpen).toBe(false)
  })
})

describe('the untracked records notice', () => {
  it('is shown once, and remembered in its setting', () => {
    const values: Record<string, unknown> = { 'terminator.foundry.dataDir': '' }
    const showToast = vi.fn()
    noteUntrackedDataRoot(host(values, showToast), '/repos/app/.foundry')
    noteUntrackedDataRoot(host(values, showToast), '/repos/app/.foundry')
    expect(showToast).toHaveBeenCalledTimes(1)
    expect(values['terminator.foundry.untrackedNoticeSeen']).toBe(true)
  })

  it('is not shown when its setting says it has been', () => {
    const showToast = vi.fn()
    const seen = {
      'terminator.foundry.dataDir': '',
      'terminator.foundry.untrackedNoticeSeen': true,
    }
    noteUntrackedDataRoot(host(seen, showToast), '/repos/app/.foundry')
    expect(showToast).not.toHaveBeenCalled()
  })

  it("is not shown, or remembered, while the records are in the app's own folder", () => {
    const values: Record<string, unknown> = { 'terminator.foundry.dataDir': '' }
    const showToast = vi.fn()
    noteUntrackedDataRoot(host(values, showToast), '/app-data/foundry/records/.foundry')
    expect(showToast).not.toHaveBeenCalled()
    expect(values['terminator.foundry.untrackedNoticeSeen']).toBeUndefined()
  })
})
