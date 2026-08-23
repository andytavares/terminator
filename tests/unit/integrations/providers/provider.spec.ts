import { describe, it, expect } from 'vitest'
import {
  PROVIDER_OPERATIONS,
  PROVIDER_WRITE_OPERATIONS,
} from '../../../../src/main/integrations/providers/provider'
import { createLinearProvider } from '../../../../src/main/integrations/providers/linear.provider'
import { createJiraProvider } from '../../../../src/main/integrations/providers/jira.provider'

// FR-034 and SC-014: no field of an issue other than its comments is ever
// modified by this application.
//
// That rule was previously enforced by nobody having written a method to break
// it, which is not enforcement — the next provider, or the next commit to an
// existing one, could add `transition()` and no test would notice. This tests
// the shape of the surface itself.

const providers = [
  ['linear', createLinearProvider(() => ({}) as never)],
  ['jira', createJiraProvider()],
] as const

// Anything matching these would be a write we have not sanctioned.
const MUTATION_PATTERNS = [
  /^transition/i,
  /^update/i,
  /^set/i,
  /^assign/i,
  /^close/i,
  /^move/i,
  /^create(?!Comment$)/i,
  /^delete/i,
  /^archive/i,
  /^label/i,
  /^estimate/i,
]

describe('TrackerProvider surface', () => {
  it.each(providers)('%s exposes exactly the sanctioned operations', (_name, provider) => {
    const own = Object.keys(provider).filter(
      (key) => typeof (provider as never)[key] === 'function'
    )
    expect(own.sort()).toEqual([...PROVIDER_OPERATIONS].sort())
  })

  it.each(providers)('%s exposes no mutation beyond comment', (_name, provider) => {
    const methods = Object.keys(provider).filter(
      (key) => typeof (provider as never)[key] === 'function'
    )
    for (const method of methods) {
      if ((PROVIDER_WRITE_OPERATIONS as readonly string[]).includes(method)) continue
      for (const pattern of MUTATION_PATTERNS) {
        expect(
          pattern.test(method),
          `provider method "${method}" looks like a mutation; FR-034 permits only comment`
        ).toBe(false)
      }
    }
  })

  it('sanctions exactly one write operation', () => {
    expect(PROVIDER_WRITE_OPERATIONS).toEqual(['comment'])
  })

  it.each(providers)('%s reports its own tracker id', (name, provider) => {
    expect(provider.id).toBe(name)
  })
})
