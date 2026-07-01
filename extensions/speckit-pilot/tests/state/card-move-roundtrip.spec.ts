import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import * as fs from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'
import { createInitialState, writeState, readState } from '../../src/state/state-persistence.js'
import { buildCardSummary } from '../../src/state/card-summary.js'

let repo: string
let featureDir: string

beforeEach(async () => {
  repo = await fs.mkdtemp(path.join(os.tmpdir(), 'sk-move-'))
  featureDir = path.join(repo, 'specs', '016-demo')
  await fs.mkdir(featureDir, { recursive: true })
})

afterEach(async () => {
  await fs.rm(repo, { recursive: true, force: true })
})

describe('card stage move round-trip (real fs)', () => {
  it('persists a manual stage change and reflects it in the summary', async () => {
    // backlog card, no run
    const state = createInitialState(featureDir)
    expect(state.stage).toBe('backlog')
    await writeState(featureDir, state)

    // simulate the card-move handler: set stage, write back
    const loaded = await readState(featureDir)
    expect(loaded).not.toBeNull()
    loaded!.stage = 'in-progress'
    await writeState(featureDir, loaded!)

    // re-read (what card-list does) and summarize
    const reread = await readState(featureDir)
    expect(reread!.stage).toBe('in-progress')
    expect(buildCardSummary(reread!, null).stage).toBe('in-progress')
  })
})
