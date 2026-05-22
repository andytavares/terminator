import { describe, it, expect, vi, beforeEach } from 'vitest'
import * as fs from 'node:fs/promises'
import * as path from 'node:path'

vi.mock('node:fs/promises')

import {
  ensurePilotDir,
  readState,
  writeState,
  appendHistory,
  createInitialState,
} from '../../src/state/state-persistence.js'
import { PHASE_ORDER } from '../../src/types/speckit.types.js'
import type { PilotState, HistoryEntry } from '../../src/types/speckit.types.js'

const featureDir = '/specs/my-feature'
const pilotDir = path.join(featureDir, '.pilot')
const statePath = path.join(pilotDir, 'state.json')
const historyPath = path.join(pilotDir, 'history.jsonl')

beforeEach(() => {
  vi.clearAllMocks()
})

describe('ensurePilotDir', () => {
  it('creates the .pilot directory recursively', async () => {
    vi.mocked(fs.mkdir).mockResolvedValue(undefined)
    await ensurePilotDir(featureDir)
    expect(fs.mkdir).toHaveBeenCalledWith(pilotDir, { recursive: true })
  })
})

describe('readState', () => {
  it('returns null when file does not exist', async () => {
    vi.mocked(fs.readFile).mockRejectedValue(Object.assign(new Error('ENOENT'), { code: 'ENOENT' }))
    const result = await readState(featureDir)
    expect(result).toBeNull()
  })

  it('returns null when file contains invalid JSON', async () => {
    vi.mocked(fs.readFile).mockResolvedValue('not-json')
    const result = await readState(featureDir)
    expect(result).toBeNull()
  })

  it('returns null when JSON fails schema validation', async () => {
    vi.mocked(fs.readFile).mockResolvedValue(JSON.stringify({ version: 999, invalid: true }))
    const result = await readState(featureDir)
    expect(result).toBeNull()
  })

  it('returns parsed state when file is valid', async () => {
    const state = createInitialState(featureDir)
    vi.mocked(fs.readFile).mockResolvedValue(JSON.stringify(state))
    const result = await readState(featureDir)
    expect(result).not.toBeNull()
    expect(result?.version).toBe(1)
    expect(result?.featureDir).toBe(featureDir)
  })

  it('reads from the correct file path', async () => {
    vi.mocked(fs.readFile).mockRejectedValue(new Error('ENOENT'))
    await readState(featureDir)
    expect(fs.readFile).toHaveBeenCalledWith(statePath, 'utf-8')
  })
})

describe('writeState', () => {
  it('calls ensurePilotDir before writing', async () => {
    vi.mocked(fs.mkdir).mockResolvedValue(undefined)
    vi.mocked(fs.writeFile).mockResolvedValue(undefined)
    vi.mocked(fs.rename).mockResolvedValue(undefined)
    const state = createInitialState(featureDir)
    await writeState(featureDir, state)
    expect(fs.mkdir).toHaveBeenCalledWith(pilotDir, { recursive: true })
  })

  it('writes to a .tmp file then renames atomically', async () => {
    vi.mocked(fs.mkdir).mockResolvedValue(undefined)
    vi.mocked(fs.writeFile).mockResolvedValue(undefined)
    vi.mocked(fs.rename).mockResolvedValue(undefined)
    const state = createInitialState(featureDir)
    await writeState(featureDir, state)
    const tmpPath = `${statePath}.tmp`
    expect(fs.writeFile).toHaveBeenCalledWith(tmpPath, expect.any(String), 'utf-8')
    expect(fs.rename).toHaveBeenCalledWith(tmpPath, statePath)
  })

  it('writes valid JSON for the state', async () => {
    vi.mocked(fs.mkdir).mockResolvedValue(undefined)
    vi.mocked(fs.writeFile).mockResolvedValue(undefined)
    vi.mocked(fs.rename).mockResolvedValue(undefined)
    const state = createInitialState(featureDir)
    await writeState(featureDir, state)
    const writtenContent = vi.mocked(fs.writeFile).mock.calls[0][1] as string
    expect(() => JSON.parse(writtenContent)).not.toThrow()
    const parsed = JSON.parse(writtenContent) as PilotState
    expect(parsed.version).toBe(1)
  })
})

describe('appendHistory', () => {
  it('calls ensurePilotDir before appending', async () => {
    vi.mocked(fs.mkdir).mockResolvedValue(undefined)
    vi.mocked(fs.appendFile).mockResolvedValue(undefined)
    const entry: HistoryEntry = {
      ts: new Date().toISOString(),
      actor: 'tester',
      action: 'approved',
      phase: 'specify',
    }
    await appendHistory(featureDir, entry)
    expect(fs.mkdir).toHaveBeenCalledWith(pilotDir, { recursive: true })
  })

  it('appends JSON line to the history file', async () => {
    vi.mocked(fs.mkdir).mockResolvedValue(undefined)
    vi.mocked(fs.appendFile).mockResolvedValue(undefined)
    const entry: HistoryEntry = {
      ts: '2026-01-01T00:00:00.000Z',
      actor: 'andrew',
      action: 'run_start',
      phase: 'plan',
      runId: 'run-abc',
    }
    await appendHistory(featureDir, entry)
    const content = vi.mocked(fs.appendFile).mock.calls[0][1] as string
    expect(content).toBe(JSON.stringify(entry) + '\n')
    expect(fs.appendFile).toHaveBeenCalledWith(historyPath, expect.any(String), 'utf-8')
  })
})

describe('createInitialState', () => {
  it('returns state with version 1', () => {
    const state = createInitialState(featureDir)
    expect(state.version).toBe(1)
  })

  it('returns state with the provided featureDir', () => {
    const state = createInitialState('/some/other/dir')
    expect(state.featureDir).toBe('/some/other/dir')
  })

  it('creates a phase for every phase in PHASE_ORDER', () => {
    const state = createInitialState(featureDir)
    for (const phaseId of PHASE_ORDER) {
      expect(state.phases[phaseId]).toBeDefined()
      expect(state.phases[phaseId].id).toBe(phaseId)
    }
  })

  it('sets first phase status to "ready"', () => {
    const state = createInitialState(featureDir)
    const firstPhase = PHASE_ORDER[0]
    expect(state.phases[firstPhase].status).toBe('ready')
  })

  it('sets all subsequent phases status to "locked"', () => {
    const state = createInitialState(featureDir)
    for (const phaseId of PHASE_ORDER.slice(1)) {
      expect(state.phases[phaseId].status).toBe('locked')
    }
  })

  it('initializes all phases with null approved fields', () => {
    const state = createInitialState(featureDir)
    for (const phaseId of PHASE_ORDER) {
      const phase = state.phases[phaseId]
      expect(phase.approvedHash).toBeNull()
      expect(phase.approvedAt).toBeNull()
      expect(phase.approvedBy).toBeNull()
      expect(phase.lastRunId).toBeNull()
      expect(phase.lastRunAt).toBeNull()
    }
  })

  it('includes default settings', () => {
    const state = createInitialState(featureDir)
    expect(state.settings).toBeDefined()
    expect(state.settings.defaultModel).toBeTypeOf('string')
    expect(state.settings.phaseGates).toBeDefined()
  })

  it('sets constitution phase artifactPaths to constitution file', () => {
    const state = createInitialState(featureDir)
    expect(state.phases['constitution'].artifactPaths).toContain('.specify/memory/constitution.md')
  })

  it('sets specify phase artifactPaths to spec.md under featureDir', () => {
    const state = createInitialState(featureDir)
    expect(state.phases['specify'].artifactPaths).toContain(`${featureDir}/spec.md`)
  })

  it('sets plan phase artifactPaths to include plan.md', () => {
    const state = createInitialState(featureDir)
    expect(state.phases['plan'].artifactPaths).toContain(`${featureDir}/plan.md`)
  })

  it('sets analyze phase artifactPaths to empty array', () => {
    const state = createInitialState(featureDir)
    expect(state.phases['analyze'].artifactPaths).toEqual([])
  })

  it('sets implement phase artifactPaths to empty array', () => {
    const state = createInitialState(featureDir)
    expect(state.phases['implement'].artifactPaths).toEqual([])
  })

  it('sets tasks phase artifactPaths to tasks.md', () => {
    const state = createInitialState(featureDir)
    expect(state.phases['tasks'].artifactPaths).toContain(`${featureDir}/tasks.md`)
  })

  it('sets checklist phase artifactPaths to requirements.md', () => {
    const state = createInitialState(featureDir)
    expect(state.phases['checklist'].artifactPaths).toContain(
      `${featureDir}/checklists/requirements.md`
    )
  })

  it('sets clarify phase artifactPaths to spec.md', () => {
    const state = createInitialState(featureDir)
    expect(state.phases['clarify'].artifactPaths).toContain(`${featureDir}/spec.md`)
  })
})
