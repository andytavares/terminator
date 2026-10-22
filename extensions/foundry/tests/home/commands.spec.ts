import { describe, it, expect, vi, beforeAll, beforeEach, afterAll } from 'vitest'

import { makeTempDir } from '../../../../tests/support/temp-dir'
import { fakeHost } from '../helpers/foundry-host.js'
import type { FoundryHost } from '../helpers/foundry-host.js'
import { activateFoundry, deactivate } from '../helpers/foundry-activation.js'
import { eventually } from '../../../../tests/support/eventually'
import { settleProofs } from '../../src/line/baseline.js'

vi.mock('../../src/runtime/supervised-runner.js', () => import('../helpers/supervision-mocks.js'))
vi.mock('../../src/runtime/control-server.js', () => import('../helpers/supervision-mocks.js'))

let dataDir = ''
let host: FoundryHost

type Command = (context: object, args?: object) => void

beforeAll(async () => {
  dataDir = makeTempDir('fdry-cmd-')
  host = fakeHost(() => dataDir)
  host.exec.mockResolvedValue({ exitCode: 0, stdout: '', stderr: '', timedOut: false })
  await activateFoundry(host)
})

// Creating an order starts its base-branch proof, which writes into the folder until it ends.
afterAll(async () => {
  await deactivate()
  await settleProofs()
})

beforeEach(() => {
  host.broadcast.mockClear()
  host.showToast.mockClear()
})

const newOrder = (): Command => host.commands.get('new-order') as unknown as Command

describe('new-order', () => {
  it('opens the empty intake when given no ticket', () => {
    newOrder()({})
    expect(host.broadcast).toHaveBeenCalledWith('foundry:ui.open-new-order', {})
  })

  it('creates the order from the ticket in that repository and opens it', async () => {
    vi.mocked(host.issues.get).mockResolvedValueOnce({
      key: 'WT-12',
      title: 'Interval presets',
      description: 'Presets for the workout timer',
      url: 'https://linear.app/wt/issue/WT-12',
    } as never)
    newOrder()(
      {},
      { tracker: 'linear', key: 'WT-12', title: 'Interval presets', repoRoot: dataDir }
    )
    await eventually(() =>
      expect(host.broadcast).toHaveBeenCalledWith('foundry:ui.open-order', {
        orderId: expect.any(String),
      })
    )
    expect(host.issues.get).toHaveBeenCalledWith('linear', 'WT-12')
    expect(host.broadcast).not.toHaveBeenCalledWith('foundry:ui.open-new-order', {})
  })
})

describe('new-order from a ticket Foundry cannot read', () => {
  it('says so when the ticket cannot be read', async () => {
    vi.mocked(host.issues.get).mockResolvedValueOnce(null)
    newOrder()({}, { tracker: 'linear', key: 'WT-99', title: 'x', repoRoot: dataDir })
    await eventually(() => expect(host.showToast).toHaveBeenCalledTimes(1))
    expect(host.broadcast).not.toHaveBeenCalledWith('foundry:ui.open-order', expect.anything())
  })
})
