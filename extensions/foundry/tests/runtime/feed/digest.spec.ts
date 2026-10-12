import { describe, it, expect } from 'vitest'
import { channelFor } from '../../../src/runtime/feed/digest.js'

describe('which channel an event may use', () => {
  it('lets a blocking permission request interrupt', () => {
    // The only thing that may: an agent is stopped dead until it is answered.
    expect(channelFor({ kind: 'permission_requested', sessionId: 's1' })).toBe('modal')
  })

  it('does not let a stall interrupt', () => {
    // A stall is a non-blocking indicator. Interrupting for it is how the
    // detector earns the reputation that gets it muted.
    expect(channelFor({ kind: 'stalled', sessionId: 's1' })).not.toBe('modal')
  })

  it('sends routine progress to the digest rather than to the operator', () => {
    expect(channelFor({ kind: 'progress', sessionId: 's1' })).toBe('digest')
  })
})
