import { describe, it, expect } from 'vitest'
import { inBackground, settleBackground } from '../src/background.js'
import { isPending, unfinishedWork } from '../../../tests/support/pending'

// Work the extension starts and no caller awaits (a run, the next Forge turn, a ledger line)
// keeps writing records until it ends; a spec's folder going must wait for that.
describe('work started in the background', () => {
  it('settle once every one has returned, failed ones included', async () => {
    const first = unfinishedWork()
    const second = unfinishedWork()
    inBackground(first.done)
    inBackground(second.done.then(() => Promise.reject(new Error('the work failed'))))

    const settled = settleBackground()
    expect(await isPending(settled)).toBe(true)
    first.finish()
    expect(await isPending(settled)).toBe(true)
    second.finish()
    await settled
  })
})
