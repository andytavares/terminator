import { describe, it, expect, beforeEach, vi } from 'vitest'
import * as fs from 'node:fs'
import * as path from 'node:path'
import type { Issue, SessionSnapshot, WorkItemRef } from '../../../src/shared/types/index'
import { makeTempDir } from '../../support/temp-dir'

let userData: string

vi.mock('electron', () => ({ app: { getPath: () => userData } }))

const P = '11111111-1111-4111-8111-111111111111'
const SESSION_ID = 's1'

function issue(over: Partial<Issue> = {}): Issue {
  return {
    tracker: 'linear',
    id: 'id-1',
    key: 'TAV-42',
    title: 'Unify Linear connections',
    url: 'https://linear.app/tav/issue/TAV-42',
    state: { name: 'In Progress', type: 'started' },
    assignee: null,
    description: 'Body',
    labels: [],
    branchName: null,
    completed: false,
    updatedAt: '2026-08-22T00:00:00Z',
    comments: [],
    ...over,
  }
}

function service(get = vi.fn().mockResolvedValue(issue())) {
  return { get } as never
}

const SNAPSHOT: SessionSnapshot = {
  sessionId: SESSION_ID,
  projectId: P,
  workspaceName: null,
  projectName: null,
  branch: null,
  tabTitle: 'zsh',
  shell: null,
  startedAt: '2026-09-15T10:00:00.000Z',
}

const TAV_42: WorkItemRef = { tracker: 'linear', key: 'TAV-42' }

let records: typeof import('../../../src/main/sessions/session-record-store')

async function load() {
  vi.resetModules()
  records = await import('../../../src/main/sessions/session-record-store')
  return import('../../../src/main/integrations/session-context')
}

function contextFile(): string {
  return path.join(userData, 'integrations', 'session-context', `${SESSION_ID}.json`)
}

beforeEach(() => {
  userData = makeTempDir('session-context-ud-')
})

describe('syncSessionContext — linked', () => {
  it('writes the session context file the hook will read', async () => {
    const mod = await load()
    await records.setLink(SNAPSHOT, TAV_42)
    await mod.syncSessionContext(SESSION_ID, service())

    expect(fs.existsSync(contextFile())).toBe(true)
    const written = JSON.parse(fs.readFileSync(contextFile(), 'utf8'))
    expect(written.markdown).toContain('TAV-42')
  })

  it('returns the context so a caller can report its size', async () => {
    const mod = await load()
    await records.setLink(SNAPSHOT, TAV_42)
    const context = await mod.syncSessionContext(SESSION_ID, service())
    expect(context?.chars).toBeGreaterThan(0)
  })
})

describe('syncSessionContext — linked, tracker unavailable', () => {
  it('keeps the previous context when the tracker cannot be reached', async () => {
    const mod = await load()
    await records.setLink(SNAPSHOT, TAV_42)
    await mod.syncSessionContext(SESSION_ID, service())
    const before = fs.readFileSync(contextFile(), 'utf8')

    await mod.syncSessionContext(
      SESSION_ID,
      service(vi.fn().mockRejectedValue(new Error('offline')))
    )

    expect(fs.readFileSync(contextFile(), 'utf8')).toBe(before)
  })

  it('writes nothing when the issue does not exist', async () => {
    const mod = await load()
    await records.setLink(SNAPSHOT, TAV_42)
    const context = await mod.syncSessionContext(
      SESSION_ID,
      service(vi.fn().mockResolvedValue(null))
    )
    expect(context).toBeNull()
    expect(fs.existsSync(contextFile())).toBe(false)
  })
})

describe('syncSessionContext — unlinked', () => {
  it('deletes the file when there is no link', async () => {
    const mod = await load()
    await records.setLink(SNAPSHOT, TAV_42)
    await mod.syncSessionContext(SESSION_ID, service())
    expect(fs.existsSync(contextFile())).toBe(true)

    await records.setLink(SNAPSHOT, null)
    await mod.syncSessionContext(SESSION_ID, service())
    expect(fs.existsSync(contextFile())).toBe(false)
  })

  it('is harmless when there is no record for the session at all', async () => {
    const mod = await load()
    await expect(mod.syncSessionContext(SESSION_ID, service())).resolves.toBeNull()
    expect(fs.existsSync(contextFile())).toBe(false)
  })
})

describe('writeSessionContext / readSessionContext / deleteSessionContext', () => {
  it('round-trips a context, and reads null once deleted', async () => {
    const mod = await load()
    const context = {
      projectId: P,
      tracker: 'linear' as const,
      key: 'TAV-42',
      markdown: '# TAV-42',
      chars: 8,
      truncated: false,
      builtAt: '2026-09-15T10:00:00.000Z',
    }
    await mod.writeSessionContext(SESSION_ID, context)
    expect(await mod.readSessionContext(SESSION_ID)).toEqual(context)

    await mod.deleteSessionContext(SESSION_ID)
    expect(await mod.readSessionContext(SESSION_ID)).toBeNull()
  })

  it('is harmless to delete a context that was never written', async () => {
    const mod = await load()
    await expect(mod.deleteSessionContext('nobody')).resolves.toBeUndefined()
  })
})
