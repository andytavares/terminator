import { describe, expect, it, vi } from 'vitest'

// Which extension owns a channel comes from its built backend bundle, which a
// unit run may not have. These stand in for the notepad and task-vault bundles.
const BUNDLES: Record<string, string> = {
  '/notepad/src/index.js': 'register("notepad:list"); register("shared:sync")',
  '/task-vault/src/index.js': 'register("shared:sync")',
}

function bundleFor(path: unknown): string | undefined {
  const key = Object.keys(BUNDLES).find((end) => String(path).endsWith(end))
  return key === undefined ? undefined : BUNDLES[key]
}

vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs')>()
  return {
    ...actual,
    existsSync: (path: string) => bundleFor(path) !== undefined || actual.existsSync(path),
    readFileSync: (...args: Parameters<typeof actual.readFileSync>) =>
      bundleFor(args[0]) ?? actual.readFileSync(...args),
  }
})

const { coverageReport } = await import('../../../scripts/feature-coverage.mjs')

const INVENTORY = {
  extensions: ['terminator.notepad', 'terminator.task-vault'],
  channels: { invoke: ['notepad:list', 'shared:sync'], send: [] },
  commands: [],
  settings: [],
}

describe('coverageReport — channel owners', () => {
  it('files a channel one extension names under that extension', () => {
    const lines = coverageReport(INVENTORY, [
      { spec: 'a.spec.ts', entries: [['invoke', 'notepad:list', {}]] },
    ]).split('\n')
    expect(lines).toContain('| terminator.notepad IPC | 1 | 1 | 100% |')
    expect(lines).toContain('### terminator.notepad IPC: 1 of 1 driven')
    expect(lines).toContain('- `notepad:list`: a.spec.ts')
    expect(lines).toContain('### terminator.task-vault IPC: none registered')
  })

  it('leaves a channel two extensions name with the unowned ones', () => {
    const lines = coverageReport(INVENTORY, []).split('\n')
    expect(lines).toContain('- `shared:sync`')
    expect(lines).toContain('| terminator.notepad IPC | 0 | 1 | 0% |')
  })
})
