import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import * as fs from 'node:fs'
import * as path from 'node:path'
import type { SessionRecord } from '../../../src/shared/types/index'
import { makeTempDir } from '../../support/temp-dir'
import { eventually } from '../../support/eventually'

// macOS arms fs.watch a moment after it returns and has no event for it
// (https://nodejs.org/api/fs.html#caveats), so a report written in that moment has no event.
// Here the watch is a stand-in that reports only what the spec tells it to.

let userData: string
let reportToWatcher: (name: string) => void

vi.mock('electron', () => ({ app: { getPath: () => userData } }))
vi.mock('node:fs', async (importOriginal) => {
  const real = await importOriginal<typeof import('node:fs')>()
  const watch = (_directory: string, listener: (event: string, name: string) => void) => {
    reportToWatcher = (name) => listener('rename', name)
    return { on: () => undefined, close: () => undefined }
  }
  return { ...real, watch }
})

let recorded: SessionRecord[]
let stop: (() => void) | undefined

async function startWatcher(): Promise<string> {
  vi.resetModules()
  const records = await import('../../../src/main/sessions/session-record-store')
  records.onRecordChange((_id, record) => {
    if (record !== null) recorded.push(record)
  })
  const { startAgentSessionWatcher } = await import(
    '../../../src/main/agents/agent-session-watcher'
  )
  stop = startAgentSessionWatcher({ snapshotFor: (sessionId) => terminalSnapshot(sessionId) })
  return path.join(userData, 'agent-sessions')
}

const terminalSnapshot = (sessionId: string) => ({
  sessionId,
  projectId: 'p1',
  workspaceName: 'Repo',
  projectName: 'main',
  branch: 'main',
  tabTitle: 'claude',
  shell: '/bin/zsh',
  startedAt: '2026-09-15T10:00:00.000Z',
})

const unreportedReport = {
  terminal: 'sess-1',
  provider: 'claude',
  sessionId: 'conv-1',
  transcriptPath: '/transcripts/x.jsonl',
  cwd: '/code/repo',
  source: 'startup',
  at: '2026-09-15T18:00:00.000Z',
}

beforeEach(() => {
  recorded = []
  userData = makeTempDir('agent-watch-arming-')
})

afterEach(() => stop?.())

describe('the agent session watcher, before its watch is armed', () => {
  it('records a report the watch never announced, once the watch proves it is armed', async () => {
    const directory = await startWatcher()
    fs.writeFileSync(path.join(directory, 'sess-1.json'), JSON.stringify(unreportedReport))

    const probe = fs.readdirSync(directory).find((name) => !name.endsWith('.json'))
    reportToWatcher(probe ?? 'no probe was written')

    await eventually(() => expect(recorded.map((r) => r.agent?.sessionId)).toEqual(['conv-1']))
    expect(fs.readdirSync(directory)).toEqual([])
  })
})
