import { describe, expect, it } from 'vitest'
import { breakoutFrameName, sessionIdOfFrameName } from '../../../src/shared/breakout'

const SESSION_ID = '7f1c2a9e-3b4d-4e5f-8a6b-1c2d3e4f5a6b'

describe('breakout frame names', () => {
  it('reads back the session a frame name was made for', () => {
    expect(sessionIdOfFrameName(breakoutFrameName(SESSION_ID))).toBe(SESSION_ID)
  })

  it('refuses a frame name with another prefix', () => {
    expect(sessionIdOfFrameName(`other:${SESSION_ID}`)).toBeNull()
  })

  it('refuses a frame name whose session id is not a uuid', () => {
    expect(sessionIdOfFrameName('terminator-session:../../etc')).toBeNull()
    expect(sessionIdOfFrameName('terminator-session:')).toBeNull()
  })
})
