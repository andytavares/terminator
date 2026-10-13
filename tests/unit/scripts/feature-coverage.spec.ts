import { describe, expect, it } from 'vitest'
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { makeTempDir } from '../../support/temp-dir'
import {
  coreChannels,
  coverageReport,
  readTraces,
  drivenFeatures,
  patchPaths,
  settingSpecs,
} from '../../../scripts/feature-coverage.mjs'

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

describe('drivenFeatures — payloads that name nothing', () => {
  it('credits only the channel when a command, setting or patch carries nothing to name', () => {
    const driven = drivenFeatures([
      {
        spec: 'a.spec.ts',
        entries: [
          ['invoke', 'extension:run-command', null],
          ['invoke', 'extension:update-setting', { value: 3 }],
          ['invoke', 'settings:update-global', {}],
        ],
      },
    ])
    expect([...driven.channels.keys()]).toEqual([
      'extension:run-command',
      'extension:update-setting',
      'settings:update-global',
    ])
    expect(driven.commands.size + driven.extensionSettings.size).toBe(0)
    expect(driven.globalSettings.size + driven.quickActions.size).toBe(0)
  })
})

describe('settingSpecs', () => {
  const driven = drivenFeatures([
    {
      spec: 'a.spec.ts',
      entries: [
        ['invoke', 'extension:update-setting', { key: 'x.maxFiles', value: 3 }],
        ['invoke', 'x:db.reinit', null],
      ],
    },
  ])

  it('credits a stored setting to the specs that wrote it', () => {
    expect([...settingSpecs({ key: 'x.maxFiles', type: 'number' }, driven)!]).toEqual(['a.spec.ts'])
  })

  // An action setting is a button: it stores nothing, it runs its channel.
  it('credits an action setting to the specs that ran its channel', () => {
    const action = { key: 'x.db.reinit', type: 'action', channel: 'x:db.reinit' }
    expect([...settingSpecs(action, driven)!]).toEqual(['a.spec.ts'])
    expect(settingSpecs({ ...action, channel: 'x:db.reset' }, driven)).toBeUndefined()
  })
})

/** An inventory with one extension whose built bundle names none of its channels. */
const INVENTORY = {
  extensions: ['probe'],
  channels: { invoke: ['workspace:list', 'probe:ping'], send: ['probe:ping'] },
  commands: [
    { key: 'probe.hello', label: 'Hello' },
    { key: 'probe.bye', label: 'Bye' },
  ],
  settings: [
    { key: 'probe.color', label: 'Color', type: 'string' },
    { key: 'probe.reset', label: 'Reset', type: 'action', channel: 'probe:ping' },
  ],
}

const PATCH = {
  appearance: { theme: 'light' },
  quickActions: { usage: [{ id: 'session:abc' }], directUse: [{ id: 'core.new-tab' }] },
}

const TRACES = [
  {
    spec: 'a.spec.ts',
    entries: [
      ['invoke', 'workspace:list', {}],
      ['invoke', 'extension:execute-command', { key: 'probe.hello' }],
      ['invoke', 'probe:ping', {}],
      ['invoke', 'settings:update-global', { patch: PATCH }],
    ],
  },
  { spec: 'b.spec.ts', entries: [['invoke', 'workspace:list', {}]] },
]

describe('coverageReport — the summary', () => {
  it('counts what was driven in each area, and marks an empty one', () => {
    const lines = coverageReport(INVENTORY, TRACES).split('\n')
    expect(lines.slice(0, 2)).toEqual([
      '| Area | Driven | Total | Share |',
      '| --- | --- | --- | --- |',
    ])
    expect(lines).toContain('| probe IPC | 0 | 0 | — |')
    expect(lines).toContain('| Commands (Quick Actions, menus) | 1 | 2 | 50% |')
    expect(lines).toContain('| Extension settings | 1 | 2 | 50% |')
    expect(lines).toContain('### probe IPC: none registered')
  })
})

describe('coverageReport — the sections', () => {
  it('lists what was not driven, and which specs drove the rest', () => {
    const lines = coverageReport(INVENTORY, TRACES).split('\n')
    expect(lines).toContain('### Extension commands: 1 of 2 driven')
    expect(lines).toContain('- `probe.bye` — Bye')
    expect(lines).toContain('- `probe.hello` — Hello: a.spec.ts')
    expect(lines).toContain('- `probe.reset` — Reset: a.spec.ts')
    const workspaceList = /^- `workspace:list` — .*: a\.spec\.ts, b\.spec\.ts$/
    expect(lines.some((line) => workspaceList.test(line))).toBe(true)
    expect(lines).toContain('- `session:*` (one per session): a.spec.ts')
    expect(lines).toContain('- `core.new-tab`: a.spec.ts')
  })

  it('lists the global settings written and the channels nothing names', () => {
    const lines = coverageReport(INVENTORY, TRACES).split('\n')
    expect(lines).toContain('- `appearance.theme`: a.spec.ts')
    expect(lines).toContain('- `quickActions.usage`: a.spec.ts')
    expect(lines).toContain('- `probe:ping` (driven: a.spec.ts)')
  })

  it('says None. when no spec wrote a global setting, and an undriven channel bare', () => {
    const lines = coverageReport(INVENTORY, []).split('\n')
    expect(lines).toContain('None.')
    expect(lines).toContain('- `probe:ping`')
    expect(lines).toContain('| Commands (Quick Actions, menus) | 0 | 2 | 0% |')
  })
})

describe('readTraces', () => {
  it('reads each .jsonl trace as one spec, one entry per line', () => {
    const directory = makeTempDir('feature-traces-')
    writeFileSync(join(directory, 'a.spec.jsonl'), '["invoke","x",{}]\n\n["event","y",null]\n')
    writeFileSync(join(directory, 'notes.txt'), 'ignored')
    expect(readTraces(directory)).toEqual([
      {
        spec: 'a.spec',
        entries: [
          ['invoke', 'x', {}],
          ['event', 'y', null],
        ],
      },
    ])
  })
})
