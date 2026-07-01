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
  readCard,
  writeCard,
  appendComment,
  readComments,
  consumePendingComments,
} from '../../src/state/state-persistence.js'
import { PHASE_ORDER, createDefaultBrief } from '../../src/types/speckit.types.js'
import type { PilotState, HistoryEntry, CardComment } from '../../src/types/speckit.types.js'

const featureDir = '/specs/my-feature'
const pilotDir = path.join(featureDir, '.pilot')
const statePath = path.join(pilotDir, 'state.json')
const historyPath = path.join(pilotDir, 'history.jsonl')
const cardPath = path.join(pilotDir, 'card.json')
const commentsPath = path.join(pilotDir, 'comments.jsonl')

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
    vi.mocked(fs.readFile).mockResolvedValue('not-json' as unknown as Uint8Array)
    const result = await readState(featureDir)
    expect(result).toBeNull()
  })

  it('returns null when JSON fails schema validation', async () => {
    vi.mocked(fs.readFile).mockResolvedValue(
      JSON.stringify({ version: 999, invalid: true }) as unknown as Uint8Array
    )
    const result = await readState(featureDir)
    expect(result).toBeNull()
  })

  it('returns v3 state when file is valid v3', async () => {
    const state = createInitialState(featureDir)
    vi.mocked(fs.readFile).mockResolvedValue(JSON.stringify(state) as unknown as Uint8Array)
    const result = await readState(featureDir)
    expect(result).not.toBeNull()
    expect(result?.version).toBe(3)
    expect(result?.featureDir).toBe(featureDir)
    expect(result?.card).toBeDefined()
    expect(result?.stage).toBe('backlog')
  })

  it('migrates v2 state to v3 by synthesizing a card and deriving the stage', async () => {
    const v2State = {
      version: 2,
      featureDir,
      ticket: {
        source: 'linear' as const,
        key: 'ENG-9',
        sourceUrl: 'https://linear.app/t/9',
        title: 'Legacy ticket',
      },
      run: null,
      queuePosition: null,
      worktreePath: null,
      branchName: null,
      prUrl: null,
      phases: createInitialState(featureDir).phases,
      settings: createInitialState(featureDir).settings,
    }
    vi.mocked(fs.readFile).mockResolvedValue(JSON.stringify(v2State) as unknown as Uint8Array)
    const result = await readState(featureDir)
    expect(result?.version).toBe(3)
    expect(result?.card.title).toBe('Legacy ticket')
    expect(result?.card.source).toBe('linear')
    expect(result?.stage).toBe('backlog')
    expect(result?.settings.maxConcurrentRuns).toBe(3)
  })

  it('migrates v1 state to v3 by adding null fields', async () => {
    const v1State = {
      version: 1,
      featureDir,
      phases: Object.fromEntries(
        PHASE_ORDER.filter((id) => id !== 'self-review' && id !== 'open-pr').map((id, idx) => [
          id,
          {
            id,
            status: idx === 0 ? 'ready' : 'locked',
            approvedHash: null,
            approvedAt: null,
            approvedBy: null,
            lastRunId: null,
            lastRunAt: null,
            artifactPaths: [],
            feedback: null,
            batchIndex: null,
          },
        ])
      ),
      settings: {
        defaultModel: 'claude-opus-4-6',
        phaseGates: {},
        disallowedPaths: [],
        maxFilesPerImplementRun: 25,
        maxTokensPerCommand: 50000,
        commandTimeoutMs: 300000,
        requireCleanTreeForImplement: true,
        createCheckpointBeforeImplement: true,
        runConsolePosition: 'bottom',
        reviewerIdentity: 'git',
        customReviewerName: null,
        branchConvention: 'sequential',
        customBranchPattern: null,
        openSidebarOnStart: true,
      },
    }
    vi.mocked(fs.readFile).mockResolvedValue(JSON.stringify(v1State) as unknown as Uint8Array)
    const result = await readState(featureDir)
    expect(result?.version).toBe(3)
    expect(result?.card).toBeDefined()
    expect(result?.stage).toBe('backlog')
    expect(result?.ticket).toBeNull()
    expect(result?.run).toBeNull()
    expect(result?.queuePosition).toBeNull()
    expect(result?.worktreePath).toBeNull()
    expect(result?.branchName).toBeNull()
    expect(result?.prUrl).toBeNull()
  })

  it('reads from the correct file path', async () => {
    vi.mocked(fs.readFile).mockRejectedValue(new Error('ENOENT'))
    await readState(featureDir)
    expect(fs.readFile).toHaveBeenCalledWith(statePath, 'utf-8')
  })

  it('restores in-flight run state on cold load (restart recovery)', async () => {
    const state = createInitialState(featureDir, {
      run: {
        status: 'running',
        startedAt: '2026-06-27T00:00:00.000Z',
        completedAt: null,
        autonomyLevel: 'standard',
      },
      queuePosition: 'active',
      worktreePath: '/repos/project/.wt/my-feature',
      branchName: 'feature/my-feature',
      ticket: {
        source: 'linear',
        key: 'ENG-42',
        sourceUrl: 'https://linear.app/t/42',
        title: 'My feature',
      },
    })
    vi.mocked(fs.readFile).mockResolvedValue(JSON.stringify(state) as unknown as Uint8Array)
    const result = await readState(featureDir)
    expect(result?.run?.status).toBe('running')
    expect(result?.queuePosition).toBe('active')
    expect(result?.worktreePath).toBe('/repos/project/.wt/my-feature')
    expect(result?.ticket?.key).toBe('ENG-42')
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

  it('writes valid JSON v2 state', async () => {
    vi.mocked(fs.mkdir).mockResolvedValue(undefined)
    vi.mocked(fs.writeFile).mockResolvedValue(undefined)
    vi.mocked(fs.rename).mockResolvedValue(undefined)
    const state = createInitialState(featureDir)
    await writeState(featureDir, state)
    const writtenContent = vi.mocked(fs.writeFile).mock.calls[0][1] as string
    expect(() => JSON.parse(writtenContent)).not.toThrow()
    const parsed = JSON.parse(writtenContent) as PilotState
    expect(parsed.version).toBe(3)
  })

  it('preserves ticket, run, and queuePosition fields on write', async () => {
    vi.mocked(fs.mkdir).mockResolvedValue(undefined)
    vi.mocked(fs.writeFile).mockResolvedValue(undefined)
    vi.mocked(fs.rename).mockResolvedValue(undefined)
    const state = createInitialState(featureDir, {
      ticket: {
        source: 'jira',
        key: 'PROJ-1',
        sourceUrl: 'https://jira.example.com/browse/PROJ-1',
        title: 'Test',
      },
      run: {
        status: 'running',
        startedAt: new Date().toISOString(),
        completedAt: null,
        autonomyLevel: 'fast',
      },
      queuePosition: 'active',
    })
    await writeState(featureDir, state)
    const writtenContent = vi.mocked(fs.writeFile).mock.calls[0][1] as string
    const parsed = JSON.parse(writtenContent) as PilotState
    expect(parsed.ticket?.key).toBe('PROJ-1')
    expect(parsed.run?.status).toBe('running')
    expect(parsed.queuePosition).toBe('active')
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

  it('can append new action types: request_changes, pr_opened, comment', async () => {
    vi.mocked(fs.mkdir).mockResolvedValue(undefined)
    vi.mocked(fs.appendFile).mockResolvedValue(undefined)
    const entry: HistoryEntry = {
      ts: new Date().toISOString(),
      actor: 'andrew',
      action: 'request_changes',
      phase: 'specify',
      note: 'Please add more detail to AC section',
    }
    await appendHistory(featureDir, entry)
    const content = vi.mocked(fs.appendFile).mock.calls[0][1] as string
    const parsed = JSON.parse(content.trim())
    expect(parsed.action).toBe('request_changes')
    expect(parsed.note).toBe('Please add more detail to AC section')
  })
})

describe('createInitialState', () => {
  it('returns state with version 3', () => {
    const state = createInitialState(featureDir)
    expect(state.version).toBe(3)
  })

  it('initializes a native card in the backlog stage', () => {
    const state = createInitialState(featureDir)
    expect(state.stage).toBe('backlog')
    expect(state.card.source).toBe('native')
    expect(state.card.title).toBe('my-feature')
    expect(state.settings.maxConcurrentRuns).toBe(3)
  })

  it('uses a provided card brief', () => {
    const brief = createDefaultBrief('Custom title', 'jira')
    const state = createInitialState(featureDir, { card: brief })
    expect(state.card.title).toBe('Custom title')
    expect(state.card.source).toBe('jira')
  })

  it('returns state with the provided featureDir', () => {
    const state = createInitialState('/some/other/dir')
    expect(state.featureDir).toBe('/some/other/dir')
  })

  it('creates a phase for every phase in PHASE_ORDER including self-review and open-pr', () => {
    const state = createInitialState(featureDir)
    for (const phaseId of PHASE_ORDER) {
      expect(state.phases[phaseId]).toBeDefined()
      expect(state.phases[phaseId].id).toBe(phaseId)
    }
    expect(state.phases['self-review']).toBeDefined()
    expect(state.phases['open-pr']).toBeDefined()
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

  it('initializes v2 fields with null defaults', () => {
    const state = createInitialState(featureDir)
    expect(state.ticket).toBeNull()
    expect(state.run).toBeNull()
    expect(state.queuePosition).toBeNull()
    expect(state.worktreePath).toBeNull()
    expect(state.branchName).toBeNull()
    expect(state.prUrl).toBeNull()
  })

  it('accepts overrides for ticket and run', () => {
    const ticket = {
      source: 'linear' as const,
      key: 'ENG-1',
      sourceUrl: 'https://linear.app',
      title: 'Test',
    }
    const run = {
      status: 'running' as const,
      startedAt: '2026-06-27T00:00:00Z',
      completedAt: null,
      autonomyLevel: 'standard' as const,
    }
    const state = createInitialState(featureDir, {
      ticket,
      run,
      queuePosition: 'active',
      worktreePath: '/wt/test',
      branchName: 'feat/test',
    })
    expect(state.ticket).toEqual(ticket)
    expect(state.run).toEqual(run)
    expect(state.queuePosition).toBe('active')
  })

  it('initializes phase feedback and batchIndex to null', () => {
    const state = createInitialState(featureDir)
    for (const phaseId of PHASE_ORDER) {
      expect(state.phases[phaseId].feedback).toBeNull()
      expect(state.phases[phaseId].batchIndex).toBeNull()
    }
  })

  it('sets self-review artifactPaths to .pilot/self-review.json', () => {
    const state = createInitialState(featureDir)
    expect(state.phases['self-review'].artifactPaths).toContain(
      `${featureDir}/.pilot/self-review.json`
    )
  })

  it('sets open-pr artifactPaths to empty array', () => {
    const state = createInitialState(featureDir)
    expect(state.phases['open-pr'].artifactPaths).toEqual([])
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

describe('card.json helpers', () => {
  it('writes the card brief atomically to card.json', async () => {
    vi.mocked(fs.mkdir).mockResolvedValue(undefined)
    vi.mocked(fs.writeFile).mockResolvedValue(undefined)
    vi.mocked(fs.rename).mockResolvedValue(undefined)
    const brief = createDefaultBrief('A card')
    await writeCard(featureDir, brief)
    const tmpPath = `${cardPath}.tmp`
    expect(fs.writeFile).toHaveBeenCalledWith(tmpPath, expect.any(String), 'utf-8')
    expect(fs.rename).toHaveBeenCalledWith(tmpPath, cardPath)
  })

  it('reads a stored card brief', async () => {
    const brief = createDefaultBrief('Stored card')
    vi.mocked(fs.readFile).mockResolvedValue(JSON.stringify(brief) as unknown as Uint8Array)
    const result = await readCard(featureDir)
    expect(result?.title).toBe('Stored card')
  })

  it('returns null when card.json is missing', async () => {
    vi.mocked(fs.readFile).mockRejectedValue(new Error('ENOENT'))
    expect(await readCard(featureDir)).toBeNull()
  })
})

describe('comments.jsonl helpers', () => {
  const comment: CardComment = {
    id: 'c1',
    author: 'you',
    body: 'Please use the existing util',
    ts: '2026-06-30T00:00:00.000Z',
  }

  it('appends a comment as a JSON line', async () => {
    vi.mocked(fs.mkdir).mockResolvedValue(undefined)
    vi.mocked(fs.appendFile).mockResolvedValue(undefined)
    await appendComment(featureDir, comment)
    expect(fs.appendFile).toHaveBeenCalledWith(
      commentsPath,
      JSON.stringify(comment) + '\n',
      'utf-8'
    )
  })

  it('reads and parses stored comments, ignoring blank lines', async () => {
    const content = JSON.stringify(comment) + '\n\n'
    vi.mocked(fs.readFile).mockResolvedValue(content as unknown as Uint8Array)
    const result = await readComments(featureDir)
    expect(result).toHaveLength(1)
    expect(result[0].body).toBe('Please use the existing util')
  })

  it('returns an empty array when comments.jsonl is missing', async () => {
    vi.mocked(fs.readFile).mockRejectedValue(new Error('ENOENT'))
    expect(await readComments(featureDir)).toEqual([])
  })
})

describe('consumePendingComments', () => {
  it('returns null and writes nothing when there are no pending comments', async () => {
    vi.mocked(fs.readFile).mockResolvedValue('' as unknown as Uint8Array)
    vi.mocked(fs.writeFile).mockClear()
    const result = await consumePendingComments(featureDir, 'run-1')
    expect(result).toBeNull()
    expect(fs.writeFile).not.toHaveBeenCalled()
  })

  it('concatenates pending bodies and marks them applied', async () => {
    const stored: CardComment[] = [
      { id: 'c1', author: 'you', body: 'Use the util', ts: 't1' },
      { id: 'c2', author: 'agent', body: 'ack', ts: 't2' },
      { id: 'c3', author: 'you', body: 'And add tests', ts: 't3', appliedToRunId: 'old' },
      { id: 'c4', author: 'you', body: 'Prefer fakes', ts: 't4' },
    ]
    vi.mocked(fs.readFile).mockResolvedValue(
      stored.map((c) => JSON.stringify(c)).join('\n') as unknown as Uint8Array
    )
    vi.mocked(fs.writeFile).mockResolvedValue(undefined)
    const result = await consumePendingComments(featureDir, 'run-9')
    expect(result).toBe('Use the util\nPrefer fakes')
    const written = vi.mocked(fs.writeFile).mock.calls[0][1] as string
    const lines = written
      .trim()
      .split('\n')
      .map((l) => JSON.parse(l) as CardComment)
    expect(lines.find((c) => c.id === 'c1')?.appliedToRunId).toBe('run-9')
    expect(lines.find((c) => c.id === 'c4')?.appliedToRunId).toBe('run-9')
    expect(lines.find((c) => c.id === 'c3')?.appliedToRunId).toBe('old')
  })
})
