import { describe, it, expect, beforeEach } from 'vitest'
import { runNodeSession } from '../../src/line/node-session.js'
import { runtime } from '../../src/runtime/runtime-state.js'
import { fakeRunner } from '../helpers/foundry-host.js'

// A node whose agent never starts must say why, so the run is not told only that it
// "exited without a status".

const runner = fakeRunner()

const context = {
  api: { workspace: { list: () => [] }, settings: { get: () => undefined } },
  order: {
    id: 'WO-1',
    source: { tracker: null, key: null },
    context: { toolchain: {} },
    provenance: {},
  },
  checkouts: new Map([[1, { path: '/work', branch: 'wo-1', origin: '/repo' }]]),
  featureDir: '/orders/WO-1',
} as never

const input = {
  node: { id: 'build:U-1', lane: 1, stepId: 'build' },
  role: 'builder',
  prompt: 'go',
  readOnly: false,
  mayUseTool: () => true,
} as never

beforeEach(() => {
  runtime.supervisedRunner = runner as never
  runner.start.mockReset()
})

describe('runNodeSession when the agent does not start', () => {
  it('keeps the reason the runner was given', async () => {
    runner.start.mockImplementation((async (options: { onStartFailed: (r: string) => void }) => {
      options.onStartFailed('Mode dontAsk is not available in this session')
      return null
    }) as never)
    expect(await runNodeSession(context, input)).toMatchObject({
      exitCode: null,
      notStarted: 'Mode dontAsk is not available in this session',
    })
  })

  // A throw is Foundry's own failure (a host call, a tab), not Claude refusing to start,
  // so it takes the ordinary failure path rather than blaming Claude.
  it('ends with no exit status and no not-started reason when the start threw', async () => {
    runner.start.mockRejectedValue(new Error('no terminal could be opened'))
    const ran = await runNodeSession(context, input)
    expect(ran.exitCode).toBeNull()
    expect(ran).not.toHaveProperty('notStarted')
  })

  it('says Claude gave no reason when nothing came with the null', async () => {
    runner.start.mockResolvedValue(null)
    expect(await runNodeSession(context, input)).toMatchObject({
      notStarted: 'Claude did not say why.',
    })
  })
})
