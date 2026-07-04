import { describe, it, expect } from 'vitest'
import {
  resolveCoreNotificationTargets,
  type CoreNotificationSettings,
} from '../../../../src/shared/notifications/resolve-targets'

const settings: CoreNotificationSettings = {
  defaultTargets: ['toast'],
  overrides: {
    terminalBell: ['system'],
    branchSwitchFailed: [],
  },
}

describe('resolveCoreNotificationTargets', () => {
  it('uses the global default when the key has no override', () => {
    expect(
      resolveCoreNotificationTargets(settings, { key: 'extensionInstalled', type: 'info' })
    ).toEqual(['toast'])
  })

  it('prefers a per-key override over the global default', () => {
    expect(resolveCoreNotificationTargets(settings, { key: 'terminalBell', type: 'info' })).toEqual(
      ['system']
    )
  })

  it('treats an empty override array as "use default"', () => {
    expect(
      resolveCoreNotificationTargets(settings, { key: 'branchSwitchFailed', type: 'info' })
    ).toEqual(['toast'])
  })

  it('force-includes toast for errors even when the resolved targets omit it', () => {
    expect(
      resolveCoreNotificationTargets(settings, { key: 'terminalBell', type: 'error' })
    ).toEqual(['system', 'toast'])
  })

  it('does not duplicate toast for errors when already present', () => {
    expect(
      resolveCoreNotificationTargets(settings, { key: 'extensionInstalled', type: 'error' })
    ).toEqual(['toast'])
  })
})
