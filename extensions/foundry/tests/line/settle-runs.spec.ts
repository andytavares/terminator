import { describe, it, expect } from 'vitest'
import { settleRuns, trackRun } from '../../src/line/run-control.js'
import { isPending, unfinishedWork } from '../../../../tests/support/pending'

// A run the extension started keeps writing its records until its executor returns; stopping
// the extension, or a spec's folder going, must wait for that.
describe('the runs this process has started', () => {
  it('settle once every one has returned, failed ones included', async () => {
    const first = unfinishedWork()
    const second = unfinishedWork()
    trackRun(first.done)
    trackRun(second.done.then(() => Promise.reject(new Error('the run failed'))))

    const settled = settleRuns()
    expect(await isPending(settled)).toBe(true)
    first.finish()
    expect(await isPending(settled)).toBe(true)
    second.finish()
    await settled
  })
})
