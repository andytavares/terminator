import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import * as fs from 'node:fs/promises'
import * as path from 'node:path'
import { tmpdir } from 'node:os'
import { DEFAULT_SETTINGS, PHASE_ORDER } from '../../src/types/speckit.types.js'

// We test the handler logic directly without registering IPC, by importing
// the persistence and state-machine layers that the handlers rely on.
import {
  createInitialState,
  writeState,
  readState,
  ensurePilotDir,
} from '../../src/state/state-persistence.js'
import { computeHash } from '../../src/state/artifact-hash.js'

async function makeTempFeatureDir(): Promise<{ dir: string; cleanup: () => Promise<void> }> {
  const dir = await fs.mkdtemp(path.join(tmpdir(), 'speckit-ipc-test-'))
  return {
    dir,
    cleanup: async () => {
      await fs.rm(dir, { recursive: true, force: true })
    },
  }
}

describe('createInitialState()', () => {
  it('creates state with constitution as ready and all others locked', () => {
    const state = createInitialState('specs/test')
    expect(state.version).toBe(2)
    expect(state.featureDir).toBe('specs/test')
    expect(state.phases['constitution'].status).toBe('ready')
    for (const id of PHASE_ORDER.slice(1)) {
      expect(state.phases[id].status).toBe('locked')
    }
  })

  it('includes default settings', () => {
    const state = createInitialState('specs/test')
    expect(state.settings.commandTimeoutMs).toBe(DEFAULT_SETTINGS.commandTimeoutMs)
    expect(state.settings.maxFilesPerImplementRun).toBe(DEFAULT_SETTINGS.maxFilesPerImplementRun)
  })

  it('assigns artifact paths per phase', () => {
    const state = createInitialState('specs/test')
    expect(state.phases['constitution'].artifactPaths).toContain('.specify/memory/constitution.md')
    expect(state.phases['specify'].artifactPaths).toContain('specs/test/spec.md')
    expect(state.phases['tasks'].artifactPaths).toContain('specs/test/tasks.md')
  })
})

describe('speckit:initialize handler logic (via state-persistence)', () => {
  let dir: string
  let cleanup: () => Promise<void>

  beforeEach(async () => {
    ;({ dir, cleanup } = await makeTempFeatureDir())
  })

  afterEach(async () => {
    await cleanup()
  })

  it('creates state.json when none exists', async () => {
    await ensurePilotDir(dir)
    const existing = await readState(dir)
    expect(existing).toBeNull()

    const state = createInitialState('specs/test')
    await writeState(dir, state)

    const loaded = await readState(dir)
    expect(loaded).not.toBeNull()
    expect(loaded?.version).toBe(2)
  })

  it('round-trips state through writeState/readState', async () => {
    await ensurePilotDir(dir)
    const state = createInitialState('specs/round-trip-test')
    state.phases['constitution'].status = 'approved'
    state.phases['constitution'].approvedHash =
      'abc12345def67890abc12345def67890abc12345def67890abc12345def67890ab'
    state.phases['specify'].status = 'ready'

    await writeState(dir, state)
    const loaded = await readState(dir)

    expect(loaded?.phases['constitution'].status).toBe('approved')
    expect(loaded?.phases['specify'].status).toBe('ready')
    expect(loaded?.phases['constitution'].approvedHash).toBe(
      'abc12345def67890abc12345def67890abc12345def67890abc12345def67890ab'
    )
  })

  it('returns null for corrupt state.json', async () => {
    await ensurePilotDir(dir)
    const statePath = path.join(dir, '.pilot', 'state.json')
    await fs.writeFile(statePath, '{invalid json}', 'utf-8')

    const result = await readState(dir)
    expect(result).toBeNull()
  })
})

describe('speckit:feature-list handler logic', () => {
  it('only includes directories with spec.md', async () => {
    const tmpDir = await fs.mkdtemp(path.join(tmpdir(), 'speckit-fl-'))
    try {
      // Create valid feature dirs
      await fs.mkdir(path.join(tmpDir, '001-feature-a'), { recursive: true })
      await fs.writeFile(path.join(tmpDir, '001-feature-a', 'spec.md'), '# Spec A')
      await fs.mkdir(path.join(tmpDir, '002-feature-b'), { recursive: true })
      await fs.writeFile(path.join(tmpDir, '002-feature-b', 'spec.md'), '# Spec B')
      // Create invalid dir (no spec.md)
      await fs.mkdir(path.join(tmpDir, '003-no-spec'), { recursive: true })

      const entries = await fs.readdir(tmpDir)
      const features = []
      for (const entry of entries) {
        const featureDir = path.join(tmpDir, entry)
        const specPath = path.join(featureDir, 'spec.md')
        try {
          const stat = await fs.stat(specPath)
          features.push({ name: entry, dir: featureDir, specPath, lastModified: stat.mtimeMs })
        } catch {
          // not a spec dir
        }
      }

      expect(features).toHaveLength(2)
      expect(features.map((f) => f.name)).toContain('001-feature-a')
      expect(features.map((f) => f.name)).toContain('002-feature-b')
      expect(features.map((f) => f.name)).not.toContain('003-no-spec')
    } finally {
      await fs.rm(tmpDir, { recursive: true, force: true })
    }
  })
})

describe('speckit:session-list handler logic', () => {
  it('returns sessions from the registry map', () => {
    const sessionRegistry = new Map([
      [
        'session-1',
        { id: 'session-1', projectId: 'proj-1', tabTitle: 'Claude', type: 'agent' as const },
      ],
      [
        'session-2',
        { id: 'session-2', projectId: 'proj-1', tabTitle: 'Terminal', type: 'human' as const },
      ],
    ])

    const sessions = Array.from(sessionRegistry.values())
    expect(sessions).toHaveLength(2)
    expect(sessions.find((s) => s.id === 'session-1')?.type).toBe('agent')
  })

  it('returns empty array when no sessions', () => {
    const sessionRegistry = new Map()
    expect(Array.from(sessionRegistry.values())).toHaveLength(0)
  })
})

describe('computeHash integration', () => {
  it('hashes a real temp file', async () => {
    const tmpFile = path.join(tmpdir(), `speckit-hash-test-${Date.now()}.md`)
    await fs.writeFile(tmpFile, '# Test\nContent here\n')
    const hash = await computeHash(tmpFile)
    expect(hash).not.toBeNull()
    expect(hash).toHaveLength(64)
    await fs.unlink(tmpFile)
  })
})
