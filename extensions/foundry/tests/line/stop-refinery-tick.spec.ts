/**
 * Stopping the refinery tick answers when the tick in flight has ended, so a spec (or a
 * deactivation) that stops it knows nothing of it is still running.
 */
import * as fs from 'node:fs'
import * as path from 'node:path'
import { describe, it, expect, vi, afterEach } from 'vitest'

import { fakeHost, temporaryDirectory, execSucceeded } from '../helpers/foundry-host.js'
import { agreedLineOrder } from '../helpers/line-run.js'
import { startRefineryTick, stopRefineryTick } from '../../src/line/refinery-run.js'
import { createOrderStore } from '../../src/order/store.js'
import { orderDir } from '../../src/data-root.js'
import { eventually } from '../../../../tests/support/eventually'
import { partialFake } from '../../../../tests/support/fakes'
import type { ActivationContext } from '../../src/ipc/register.js'

afterEach(async () => {
  await stopRefineryTick()
  vi.useRealTimers()
})

describe('stopping the refinery tick', () => {
  it('settles only once the tick in flight has looked at its pull request', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] })
    const dataDir = temporaryDirectory('fdry-stop-refinery-tick')
    const host = fakeHost(() => dataDir)
    await createOrderStore(dataDir).save({ ...agreedLineOrder('/repos/app'), status: 'running' })
    fs.mkdirSync(orderDir(dataDir, 'WO-1'), { recursive: true })
    fs.writeFileSync(
      path.join(orderDir(dataDir, 'WO-1'), 'pulls.json'),
      JSON.stringify([{ url: 'https://github.com/owner/app/pull/1', lane: 1, bodyPath: '' }])
    )
    let releaseLook: () => void = () => undefined
    const lookHeld = new Promise<void>((resolve) => (releaseLook = resolve))
    host.gh.mockImplementation(async () => {
      await lookHeld
      return execSucceeded(JSON.stringify({ state: 'OPEN' }))
    })
    startRefineryTick(partialFake<ActivationContext>({ api: host.api, dataRoot: () => dataDir }))

    await vi.advanceTimersByTimeAsync(60_000)
    await eventually(() => expect(host.gh).toHaveBeenCalled())
    const stopped = stopRefineryTick()
    await expect(Promise.race([stopped, Promise.resolve('still running')])).resolves.toBe(
      'still running'
    )

    releaseLook()
    await expect(stopped).resolves.toBeUndefined()
  })
})
