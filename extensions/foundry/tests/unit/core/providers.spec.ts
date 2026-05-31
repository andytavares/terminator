import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import * as fs from 'node:fs/promises'
import * as path from 'node:path'
import { tmpdir } from 'node:os'

let globalDir: string

vi.mock('electron', () => ({
  app: {
    getPath: vi.fn((_name: string) => globalDir),
  },
}))

import { readProviders, writeProviders } from '../../../src/core/providers.js'
import type { StoredProvider } from '../../../src/core/providers.js'

function makeProvider(id: string, overrides: Partial<StoredProvider> = {}): StoredProvider {
  return { id, type: 'claude', label: 'Claude', model: 'claude-sonnet-4-6', ...overrides }
}

async function makeTmp(): Promise<{ dir: string; cleanup: () => Promise<void> }> {
  const dir = await fs.mkdtemp(path.join(tmpdir(), 'foundry-providers-test-'))
  return { dir, cleanup: () => fs.rm(dir, { recursive: true, force: true }) }
}

describe('readProviders()', () => {
  let cleanup: () => Promise<void>

  beforeEach(async () => {
    ;({ dir: globalDir, cleanup } = await makeTmp())
  })

  afterEach(async () => {
    await cleanup()
  })

  it('returns empty array when providers.json does not exist', async () => {
    const result = await readProviders()
    expect(result).toEqual([])
  })

  it('returns stored providers', async () => {
    const providers = [makeProvider('p1'), makeProvider('p2')]
    await fs.mkdir(path.join(globalDir, 'foundry'), { recursive: true })
    await fs.writeFile(path.join(globalDir, 'foundry', 'providers.json'), JSON.stringify(providers))
    const result = await readProviders()
    expect(result).toHaveLength(2)
    expect(result[0].id).toBe('p1')
  })

  it('returns empty array when global file missing and no workspaceRoot given', async () => {
    const result = await readProviders(undefined)
    expect(result).toEqual([])
  })

  it('migrates legacy per-workspace providers.json to global path', async () => {
    const { dir: workspaceDir, cleanup: wsCleanup } = await makeTmp()
    try {
      const providers = [makeProvider('migrated')]
      const legacyDir = path.join(workspaceDir, '.foundry')
      await fs.mkdir(legacyDir, { recursive: true })
      await fs.writeFile(path.join(legacyDir, 'providers.json'), JSON.stringify(providers))

      const result = await readProviders(workspaceDir)
      expect(result).toHaveLength(1)
      expect(result[0].id).toBe('migrated')

      // Legacy file should be removed after migration
      await expect(fs.access(path.join(legacyDir, 'providers.json'))).rejects.toThrow()

      // Global file should now exist
      const globalRaw = await fs.readFile(
        path.join(globalDir, 'foundry', 'providers.json'),
        'utf-8'
      )
      expect(JSON.parse(globalRaw)).toHaveLength(1)
    } finally {
      await wsCleanup()
    }
  })

  it('returns empty array when legacy workspace file also missing', async () => {
    const { dir: workspaceDir, cleanup: wsCleanup } = await makeTmp()
    try {
      const result = await readProviders(workspaceDir)
      expect(result).toEqual([])
    } finally {
      await wsCleanup()
    }
  })

  it('throws on non-ENOENT errors reading global file', async () => {
    // Write a directory at the providers.json path to cause EISDIR
    await fs.mkdir(path.join(globalDir, 'foundry', 'providers.json'), { recursive: true })
    await expect(readProviders()).rejects.toThrow()
  })
})

describe('writeProviders()', () => {
  let cleanup: () => Promise<void>

  beforeEach(async () => {
    ;({ dir: globalDir, cleanup } = await makeTmp())
  })

  afterEach(async () => {
    await cleanup()
  })

  it('creates foundry dir and writes providers.json', async () => {
    const providers = [makeProvider('p1')]
    await writeProviders(providers)
    const raw = await fs.readFile(path.join(globalDir, 'foundry', 'providers.json'), 'utf-8')
    const parsed = JSON.parse(raw) as StoredProvider[]
    expect(parsed[0].id).toBe('p1')
  })

  it('round-trips multiple providers', async () => {
    const providers = [makeProvider('a'), makeProvider('b', { type: 'openai', keychainKey: 'k1' })]
    await writeProviders(providers)
    const result = await readProviders()
    expect(result).toHaveLength(2)
    expect(result[1].keychainKey).toBe('k1')
  })

  it('overwrites existing file atomically', async () => {
    await writeProviders([makeProvider('old')])
    await writeProviders([makeProvider('new')])
    const result = await readProviders()
    expect(result).toHaveLength(1)
    expect(result[0].id).toBe('new')
  })
})
