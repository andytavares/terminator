import { describe, it, expect } from 'vitest'
import {
  resolveNotificationTargets,
  type NotificationSettings,
} from '../../../../src/shared/notifications/resolve-targets'

const settings: NotificationSettings = {
  defaultTargets: ['toast'],
  extensionOverrides: {
    'terminator.git-integration': ['system'],
    'terminator.notepad': [],
  },
}

describe('resolveNotificationTargets', () => {
  it('uses the global default when no source is given', () => {
    expect(resolveNotificationTargets(settings, { type: 'info' })).toEqual(['toast'])
  })

  it('uses the global default when the source has no override', () => {
    expect(
      resolveNotificationTargets(settings, { source: 'terminator.task-vault', type: 'info' })
    ).toEqual(['toast'])
  })

  it('prefers a per-extension override over the global default', () => {
    expect(
      resolveNotificationTargets(settings, { source: 'terminator.git-integration', type: 'info' })
    ).toEqual(['system'])
  })

  it('treats an empty override array as "use default"', () => {
    expect(
      resolveNotificationTargets(settings, { source: 'terminator.notepad', type: 'info' })
    ).toEqual(['toast'])
  })

  it('force-includes toast for errors even when the resolved targets omit it', () => {
    expect(
      resolveNotificationTargets(settings, { source: 'terminator.git-integration', type: 'error' })
    ).toEqual(['system', 'toast'])
  })

  it('does not duplicate toast for errors when already present', () => {
    expect(resolveNotificationTargets(settings, { type: 'error' })).toEqual(['toast'])
  })
})
