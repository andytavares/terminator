/**
 * Stopping the supervision runtime settles once what it started has ended: a recording of a
 * run's tool calls that a stall-watcher tick began. The fake below finishes when the spec says,
 * so a stop that does not wait for it settles while the work is still going.
 */
import { freshFoundryStorage } from '../helpers/foundry-host.js'

// Created before any spec mocks `node:fs`: the runtime writes its feed and mutes under it.
const GLOBAL_STORAGE = freshFoundryStorage()

import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { ExtensionAPI } from '@terminator/extension-sdk'
import { partialFake } from '../../../../tests/support/fakes'
import { runtime } from '../../src/runtime/runtime-state.js'
import {
  startSupervisionRuntime,
  stopSupervisionRuntime,
} from '../../src/runtime/supervision-runtime.js'
import { isPending, unfinishedWork } from '../../../../tests/support/pending'
import { theRunner } from '../helpers/supervision-mocks.js'

const work = vi.hoisted(() => ({
  toolsRecording: undefined as unknown as ReturnType<typeof unfinishedWork>,
  toolsRecorded: false,
}))

vi.mock('../../src/runtime/supervised-runner.js', () => import('../helpers/supervision-mocks.js'))
vi.mock('../../src/factory/timeline-store.js', () => ({
  recordTools: async () => {
    await work.toolsRecording.done
    work.toolsRecorded = true
  },
}))

const api = partialFake<ExtensionAPI>({
  log: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
  paths: { app: '', globalStorage: GLOBAL_STORAGE },
  settings: partialFake<ExtensionAPI['settings']>({ get: vi.fn(), set: vi.fn() }),
  workspace: partialFake<ExtensionAPI['workspace']>({ list: () => [], listProjects: () => [] }),
})

beforeEach(() => {
  work.toolsRecording = unfinishedWork()
  work.toolsRecorded = false
})

describe('stopSupervisionRuntime', () => {
  it('settles after the recording of a run a tick began has been written', async () => {
    await startSupervisionRuntime(api)
    theRunner.watchable.mockReturnValue([
      {
        sessionId: 'run-1',
        featureDir: '/orders/WO-1',
        transcriptPath: '/missing/transcript.jsonl',
        startedAt: 0,
        isWaiting: true,
      },
    ])
    runtime.stallWatcher?.tick()

    const stopped = stopSupervisionRuntime()
    expect(await isPending(stopped)).toBe(true)
    work.toolsRecording.finish()
    await stopped

    expect(work.toolsRecorded).toBe(true)
  })
})
