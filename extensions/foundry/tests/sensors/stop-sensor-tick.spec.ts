/**
 * Stopping the sensor tick answers when the tick in flight has ended, so a spec (or a
 * deactivation) that stops it knows nothing of it is still running.
 */
import { describe, it, expect, vi, afterEach } from 'vitest'

import { fakeHost, temporaryDirectory } from '../helpers/foundry-host.js'
import { startSensorTick, stopSensorTick } from '../../src/sensors/sensor-tick.js'
import { createSignalStore } from '../../src/sensors/store.js'
import { eventually } from '../../../../tests/support/eventually'
import { partialFake } from '../../../../tests/support/fakes'
import type { ActivationContext } from '../../src/ipc/register.js'

afterEach(async () => {
  await stopSensorTick()
  vi.useRealTimers()
})

/** A host whose tracker answers once the test lets it, with a tick started over its records. */
function tickOverHeldTracker() {
  const dataDir = temporaryDirectory('fdry-stop-sensor-tick')
  const host = fakeHost(() => dataDir)
  let releaseRead: () => void = () => undefined
  const readHeld = new Promise<void>((resolve) => (releaseRead = resolve))
  vi.mocked(host.issues.listMine).mockImplementation(async () => {
    await readHeld
    return { issues: [], failures: [] }
  })
  startSensorTick(partialFake<ActivationContext>({ api: host.api, dataRoot: () => dataDir }))
  return { dataDir, host, releaseRead }
}

describe('stopping the sensor tick', () => {
  it('settles only once the tick in flight has read its sensor', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] })
    const { dataDir, host, releaseRead } = tickOverHeldTracker()
    await createSignalStore(dataDir).setSensorState('tracker-query', {
      enabled: true,
      repoPath: '/repos/app',
      lastRunAt: null,
    })

    await vi.advanceTimersByTimeAsync(60_000)
    await eventually(() => expect(host.issues.listMine).toHaveBeenCalled())
    const stopped = stopSensorTick()
    await expect(Promise.race([stopped, Promise.resolve('still running')])).resolves.toBe(
      'still running'
    )

    releaseRead()
    await expect(stopped).resolves.toBeUndefined()
  })

  it('has run nothing, once it settles, while every sensor is off', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] })
    const { host, releaseRead } = tickOverHeldTracker()

    await vi.advanceTimersByTimeAsync(60_000)
    await stopSensorTick()
    releaseRead()

    expect(host.gh).not.toHaveBeenCalled()
    expect(host.issues.listMine).not.toHaveBeenCalled()
  })
})
