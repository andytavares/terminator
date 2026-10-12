import { describe, expect, it } from 'vitest'
import { coreChannels, drivenFeatures, patchPaths } from '../../../scripts/feature-coverage.mjs'

describe('patchPaths', () => {
  it('lists each leaf a settings patch writes, arrays as leaves', () => {
    expect(
      patchPaths({ appearance: { theme: 'light' }, git: { branchExcludePatterns: ['a'] } })
    ).toEqual(['appearance.theme', 'git.branchExcludePatterns'])
  })
})

describe('coreChannels', () => {
  it('reads path, kind and channel from each method() block, skipping local ones', () => {
    const source = `
      method({ path: 'terminal.create', kind: 'invoke', channel: 'terminal:create', signature })
      method({ path: 'getFilePath', kind: 'local', signature })
      method({ path: 'fs.onChanged', kind: 'event', channel: 'fs:changed', signature })`
    expect(coreChannels(source)).toEqual([
      { path: 'terminal.create', kind: 'invoke', channel: 'terminal:create' },
      { path: 'fs.onChanged', kind: 'event', channel: 'fs:changed' },
    ])
  })
})

describe('drivenFeatures', () => {
  it('credits each spec with the channels, commands, settings and Quick Actions it caused', () => {
    const driven = drivenFeatures([
      {
        spec: 'a.spec.ts',
        entries: [
          ['invoke', 'workspace:list', null],
          ['event', 'fs:changed', null],
          ['send', 'extension:execute-command', { key: 'x.command.push', ctx: {} }],
          ['invoke', 'extension:update-setting', { key: 'x.maxFiles', value: 3 }],
          [
            'invoke',
            'settings:update-global',
            { patch: { quickActions: { usage: [{ id: 'core.new-tab', count: 1 }] } } },
          ],
        ],
      },
      { spec: 'b.spec.ts', entries: [['invoke', 'workspace:list', null]] },
    ])

    expect([...driven.channels.get('workspace:list')!]).toEqual(['a.spec.ts', 'b.spec.ts'])
    expect(driven.channels.has('fs:changed')).toBe(false)
    expect([...driven.events.get('fs:changed')!]).toEqual(['a.spec.ts'])
    expect([...driven.commands.keys()]).toEqual(['x.command.push'])
    expect([...driven.extensionSettings.keys()]).toEqual(['x.maxFiles'])
    expect([...driven.globalSettings.keys()]).toEqual(['quickActions.usage'])
    expect([...driven.quickActions.keys()]).toEqual(['core.new-tab'])
  })
})
