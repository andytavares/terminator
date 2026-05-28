import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import * as fs from 'node:fs/promises'
import * as path from 'node:path'
import { tmpdir } from 'node:os'
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
  let dir: string
  let cleanup: () => Promise<void>

  beforeEach(async () => {
    ;({ dir, cleanup } = await makeTmp())
  })

  afterEach(async () => {
    await cleanup()
  })

  it('returns empty array when providers.json does not exist', async () => {
    const result = await readProviders(dir)
    expect(result).toEqual([])
  })

  it('returns stored providers', async () => {
    const providers = [makeProvider('p1'), makeProvider('p2')]
    await fs.mkdir(path.join(dir, '.foundry'), { recursive: true })
    await fs.writeFile(path.join(dir, '.foundry', 'providers.json'), JSON.stringify(providers))
    const result = await readProviders(dir)
    expect(result).toHaveLength(2)
    expect(result[0].id).toBe('p1')
  })
})

describe('writeProviders()', () => {
  let dir: string
  let cleanup: () => Promise<void>

  beforeEach(async () => {
    ;({ dir, cleanup } = await makeTmp())
  })

  afterEach(async () => {
    await cleanup()
  })

  it('creates .foundry dir and writes providers.json', async () => {
    const providers = [makeProvider('p1')]
    await writeProviders(dir, providers)
    const raw = await fs.readFile(path.join(dir, '.foundry', 'providers.json'), 'utf-8')
    const parsed = JSON.parse(raw) as StoredProvider[]
    expect(parsed[0].id).toBe('p1')
  })

  it('round-trips multiple providers', async () => {
    const providers = [makeProvider('a'), makeProvider('b', { type: 'openai', keychainKey: 'k1' })]
    await writeProviders(dir, providers)
    const result = await readProviders(dir)
    expect(result).toHaveLength(2)
    expect(result[1].keychainKey).toBe('k1')
  })

  it('overwrites existing file atomically', async () => {
    await writeProviders(dir, [makeProvider('old')])
    await writeProviders(dir, [makeProvider('new')])
    const result = await readProviders(dir)
    expect(result).toHaveLength(1)
    expect(result[0].id).toBe('new')
  })
})
