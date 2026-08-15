import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { PGlite } from '@electric-sql/pglite'

const { mockShowSaveDialog, mockWriteFileSync, mockMkdirSync } = vi.hoisted(() => ({
  mockShowSaveDialog: vi.fn(),
  mockWriteFileSync: vi.fn(),
  mockMkdirSync: vi.fn(),
}))

vi.mock('electron', () => ({
  dialog: { showSaveDialog: mockShowSaveDialog },
}))

vi.mock('node:fs', () => ({
  writeFileSync: mockWriteFileSync,
  mkdirSync: mockMkdirSync,
}))

import { wrapDb } from '../../../../src/main/db/index'
import { applyTaskVaultSchema } from '../../src/vault/db'
import { registerWeeklyReviewIpcHandlers } from '../../src/ipc/weekly-review.ipc'
import type { ExtensionDB } from '../../../../src/main/db/index'
import type { ExtensionAPI } from '../../../../src/main/extensions/api'

let pg: PGlite
let db: ExtensionDB
let handlers: Map<string, (payload: unknown) => Promise<unknown>>
let dispose: () => void

const mockApi = {
  ipc: {
    registerHandler: (channel: string, fn: (payload: unknown) => Promise<unknown>) => {
      handlers.set(channel, fn)
      return { dispose: () => handlers.delete(channel) }
    },
  },
} as unknown as ExtensionAPI

function invoke(channel: string, payload?: unknown): Promise<unknown> {
  const handler = handlers.get(channel)
  if (!handler) throw new Error(`no handler registered for ${channel}`)
  return handler(payload)
}

beforeEach(async () => {
  vi.clearAllMocks()
  handlers = new Map()
  pg = new PGlite()
  await pg.waitReady
  db = wrapDb(pg)
  await applyTaskVaultSchema(db)
  dispose = registerWeeklyReviewIpcHandlers(mockApi, db)
})

afterEach(async () => {
  dispose()
  await pg.close()
})

async function startReview(): Promise<string> {
  const result = (await invoke('task-vault:review:start', {})) as { review: { id: string } }
  return result.review.id
}

describe('registration', () => {
  it('registers every review channel', () => {
    expect([...handlers.keys()].sort()).toEqual([
      'task-vault:review:complete',
      'task-vault:review:export',
      'task-vault:review:get',
      'task-vault:review:list',
      'task-vault:review:log',
      'task-vault:review:start',
    ])
  })

  it('removes its handlers on dispose', () => {
    dispose()
    expect(handlers.size).toBe(0)
  })
})

describe('task-vault:review:start', () => {
  it('returns a new review', async () => {
    const result = (await invoke('task-vault:review:start', {})) as {
      review: { id: string; status: string }
      resumed: boolean
    }
    expect(result.review.status).toBe('in_progress')
    expect(result.resumed).toBe(false)
  })

  it('resumes rather than forking on a second call', async () => {
    const first = await startReview()
    const second = (await invoke('task-vault:review:start', {})) as {
      review: { id: string }
      resumed: boolean
    }
    expect(second.review.id).toBe(first)
    expect(second.resumed).toBe(true)
  })
})

describe('task-vault:review:log', () => {
  it('records an action', async () => {
    const reviewId = await startReview()
    await invoke('task-vault:review:log', {
      reviewId,
      step: 5,
      action: 'task-promoted',
      entityType: 'task',
      entityId: 't1',
      entityLabel: 'Do the thing',
    })

    const result = (await invoke('task-vault:review:get', { reviewId })) as {
      review: { actions: { entityLabel: string }[] }
    }
    expect(result.review.actions).toHaveLength(1)
    expect(result.review.actions[0].entityLabel).toBe('Do the thing')
  })

  it('rejects an unknown action kind', async () => {
    const reviewId = await startReview()
    const result = await invoke('task-vault:review:log', {
      reviewId,
      step: 1,
      action: 'not-a-real-action',
      entityType: 'task',
      entityLabel: 'x',
    })
    expect(result).toEqual({ error: 'VALIDATION_ERROR' })
  })

  it('rejects a step outside the wizard range', async () => {
    const reviewId = await startReview()
    const result = await invoke('task-vault:review:log', {
      reviewId,
      step: 9,
      action: 'captured',
      entityType: 'task',
      entityLabel: 'x',
    })
    expect(result).toEqual({ error: 'VALIDATION_ERROR' })
  })

  it('rejects a missing payload', async () => {
    expect(await invoke('task-vault:review:log', null)).toEqual({ error: 'VALIDATION_ERROR' })
  })
})

describe('task-vault:review:complete', () => {
  it('stores the reflection and closes the review', async () => {
    const reviewId = await startReview()
    await invoke('task-vault:review:complete', {
      reviewId,
      worked: 'shipping',
      didntWork: 'meetings',
      tryNext: 'fewer meetings',
    })

    const result = (await invoke('task-vault:review:get', { reviewId })) as {
      review: { status: string; worked: string; tryNext: string }
    }
    expect(result.review.status).toBe('completed')
    expect(result.review.worked).toBe('shipping')
    expect(result.review.tryNext).toBe('fewer meetings')
  })

  it('rejects a missing review id', async () => {
    expect(await invoke('task-vault:review:complete', { worked: 'x' })).toEqual({
      error: 'VALIDATION_ERROR',
    })
  })
})

describe('task-vault:review:list', () => {
  it('returns an empty list before any review exists', async () => {
    expect(await invoke('task-vault:review:list', {})).toEqual({ reviews: [] })
  })

  it('returns recorded reviews', async () => {
    await startReview()
    const result = (await invoke('task-vault:review:list', {})) as { reviews: unknown[] }
    expect(result.reviews).toHaveLength(1)
  })

  it('tolerates a missing payload', async () => {
    const result = (await invoke('task-vault:review:list', undefined)) as { reviews: unknown[] }
    expect(result.reviews).toEqual([])
  })
})

describe('task-vault:review:get', () => {
  it('reports an unknown review', async () => {
    expect(await invoke('task-vault:review:get', { reviewId: 'nope' })).toEqual({
      error: 'REVIEW_NOT_FOUND',
    })
  })

  it('rejects a missing id', async () => {
    expect(await invoke('task-vault:review:get', {})).toEqual({ error: 'VALIDATION_ERROR' })
  })
})

describe('task-vault:review:export', () => {
  it('writes markdown to the chosen path', async () => {
    const reviewId = await startReview()
    await invoke('task-vault:review:log', {
      reviewId,
      step: 5,
      action: 'task-archived',
      entityType: 'task',
      entityLabel: 'Old idea',
    })
    mockShowSaveDialog.mockResolvedValue({ canceled: false, filePath: '/tmp/review.md' })

    const result = await invoke('task-vault:review:export', { reviewId })

    expect(result).toEqual({ filePath: '/tmp/review.md' })
    const [writtenPath, contents] = mockWriteFileSync.mock.calls[0]
    expect(writtenPath).toBe('/tmp/review.md')
    expect(contents).toContain('# Weekly Review')
    expect(contents).toContain('Old idea')
  })

  it('suggests a filename based on the review date', async () => {
    const reviewId = await startReview()
    mockShowSaveDialog.mockResolvedValue({ canceled: false, filePath: '/tmp/review.md' })
    await invoke('task-vault:review:export', { reviewId })

    const options = mockShowSaveDialog.mock.calls[0][0] as { defaultPath: string }
    expect(options.defaultPath).toMatch(/^weekly-review-\d{4}-\d{2}-\d{2}\.md$/)
  })

  it('writes nothing when the user cancels', async () => {
    const reviewId = await startReview()
    mockShowSaveDialog.mockResolvedValue({ canceled: true, filePath: undefined })

    expect(await invoke('task-vault:review:export', { reviewId })).toEqual({ canceled: true })
    expect(mockWriteFileSync).not.toHaveBeenCalled()
  })

  it('reports an unknown review without opening a dialog', async () => {
    expect(await invoke('task-vault:review:export', { reviewId: 'nope' })).toEqual({
      error: 'REVIEW_NOT_FOUND',
    })
    expect(mockShowSaveDialog).not.toHaveBeenCalled()
  })

  it('surfaces a write failure as an error rather than throwing', async () => {
    const reviewId = await startReview()
    mockShowSaveDialog.mockResolvedValue({ canceled: false, filePath: '/nope/review.md' })
    mockWriteFileSync.mockImplementationOnce(() => {
      throw new Error('EACCES')
    })

    expect(await invoke('task-vault:review:export', { reviewId })).toEqual({ error: 'EACCES' })
  })
})
