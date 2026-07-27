import { describe, it, expect } from 'vitest'
import { allClearMessage } from '../../../../src/shared/supervision/all-clear.js'

// Shared by the attention queue and the status bar: two copies of this rule
// would drift, and this one is load-bearing (FR-024).

describe('the all-clear (FR-024)', () => {
  it('asserts everything is fine rather than leaving the surface blank', () => {
    // Silence is what a crashed console also looks like, so the UI has to say it.
    expect(allClearMessage(0, 3)).toContain('Nothing needs you')
    expect(allClearMessage(0, 3)).toContain('3 sessions are working')
  })

  it('says so when nothing is running either', () => {
    expect(allClearMessage(0, 0)).toContain('nothing is running')
  })

  it('uses the singular for one session', () => {
    expect(allClearMessage(0, 1)).toContain('1 session is working')
  })

  it('says nothing when something does need attention', () => {
    expect(allClearMessage(2, 3)).toBeNull()
  })
})
