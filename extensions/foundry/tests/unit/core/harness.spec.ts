import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import * as fs from 'node:fs/promises'
import * as path from 'node:path'
import { tmpdir } from 'node:os'
import { readHarness, writeHarness, detectHarnessSetupRequired } from '../../../src/core/harness.js'
import type { Harness } from '../../../src/types/foundry.types.js'

const DEFAULT_HARNESS: Harness = {
  version: 1,
  sensors: [],
  gateDefaults: {
    requireGateAfterEachIteration: true,
    sensorsMustPassBeforeGate: true,
    autoCheckpointBeforeRun: true,
    requireCleanWorkingTree: true,
  },
  providerRef: null,
  iterationLimit: 3,
  agentsMdPath: 'AGENTS.md',
}

async function makeTmp(): Promise<{ dir: string; cleanup: () => Promise<void> }> {
  const dir = await fs.mkdtemp(path.join(tmpdir(), 'foundry-harness-test-'))
  return { dir, cleanup: () => fs.rm(dir, { recursive: true, force: true }) }
}

describe('readHarness()', () => {
  let dir: string
  let cleanup: () => Promise<void>

  beforeEach(async () => {
    ;({ dir, cleanup } = await makeTmp())
  })
  afterEach(async () => cleanup())

  it('returns notFound when .foundry/harness.json is absent', async () => {
    const result = await readHarness(dir)
    expect(result).toEqual({ notFound: true })
  })

  it('reads a valid harness.json', async () => {
    const foundryDir = path.join(dir, '.foundry')
    await fs.mkdir(foundryDir, { recursive: true })
    await fs.writeFile(path.join(foundryDir, 'harness.json'), JSON.stringify(DEFAULT_HARNESS))
    const result = await readHarness(dir)
    expect(result).toEqual({ harness: DEFAULT_HARNESS })
  })

  it('returns error on malformed JSON', async () => {
    const foundryDir = path.join(dir, '.foundry')
    await fs.mkdir(foundryDir, { recursive: true })
    await fs.writeFile(path.join(foundryDir, 'harness.json'), 'not json {{{')
    const result = await readHarness(dir)
    expect(result).toHaveProperty('error')
  })

  it('does not expose apiKey or secret fields', async () => {
    const foundryDir = path.join(dir, '.foundry')
    await fs.mkdir(foundryDir, { recursive: true })
    const withSecret = { ...DEFAULT_HARNESS, apiKey: 'sk-secret' }
    await fs.writeFile(path.join(foundryDir, 'harness.json'), JSON.stringify(withSecret))
    const result = await readHarness(dir)
    if ('harness' in result) {
      expect(result.harness).not.toHaveProperty('apiKey')
    }
  })
})

describe('writeHarness()', () => {
  let dir: string
  let cleanup: () => Promise<void>

  beforeEach(async () => {
    ;({ dir, cleanup } = await makeTmp())
  })
  afterEach(async () => cleanup())

  it('writes harness.json atomically (creates .foundry dir)', async () => {
    const result = await writeHarness(dir, DEFAULT_HARNESS)
    expect(result).toEqual({ ok: true })
    const raw = await fs.readFile(path.join(dir, '.foundry', 'harness.json'), 'utf-8')
    const parsed = JSON.parse(raw)
    expect(parsed.version).toBe(1)
  })

  it('does not write apiKey or secret fields', async () => {
    const withSecret = {
      ...DEFAULT_HARNESS,
      apiKey: 'sk-secret',
      keychainKey: 'key',
    } as Harness & { apiKey: string }
    const result = await writeHarness(dir, withSecret as unknown as Harness)
    expect(result).toEqual({ ok: true })
    const raw = await fs.readFile(path.join(dir, '.foundry', 'harness.json'), 'utf-8')
    expect(raw).not.toContain('sk-secret')
  })

  it('round-trips: write then read returns same harness', async () => {
    const harness: Harness = {
      ...DEFAULT_HARNESS,
      sensors: [{ name: 'lint', command: 'npm run lint' }],
      iterationLimit: 5,
    }
    await writeHarness(dir, harness)
    const readResult = await readHarness(dir)
    expect(readResult).toEqual({ harness })
  })
})

describe('detectHarnessSetupRequired()', () => {
  let dir: string
  let cleanup: () => Promise<void>

  beforeEach(async () => {
    ;({ dir, cleanup } = await makeTmp())
  })
  afterEach(async () => cleanup())

  it('returns true when AGENTS.md is absent', async () => {
    expect(await detectHarnessSetupRequired(dir)).toBe(true)
  })

  it('returns false when AGENTS.md exists', async () => {
    await fs.writeFile(path.join(dir, 'AGENTS.md'), '# Agents\n')
    expect(await detectHarnessSetupRequired(dir)).toBe(false)
  })
})
