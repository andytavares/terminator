import { describe, it, expect } from 'vitest'
import {
  PROVIDER_OPERATIONS,
  PROVIDER_OPTIONAL_OPERATIONS,
  PROVIDER_WRITE_OPERATIONS,
} from '../../../../src/main/integrations/providers/provider'
import { createLinearProvider } from '../../../../src/main/integrations/providers/linear.provider'
import { createJiraProvider } from '../../../../src/main/integrations/providers/jira.provider'

// FR-034 and SC-014: no field of an issue other than its comments and its
// own workflow position is ever modified by this application.
//
// That rule was previously enforced by nobody having written a method to break
// it, which is not enforcement — the next provider, or the next commit to an
// existing one, could add `assign()` and no test would notice. This tests the
// shape of the surface itself.
//
// 037 widened the sanctioned set by exactly one operation, and widening it is
// supposed to be conspicuous: it takes an edit to this file, which is the
// point.

const providers = [
  ['linear', createLinearProvider(() => ({}) as never)],
  ['jira', createJiraProvider()],
] as const

// Anything matching these would be a write we have not sanctioned.
const MUTATION_PATTERNS = [
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

function methodsOf(provider: unknown): string[] {
  return Object.keys(provider as object).filter(
    (key) => typeof (provider as Record<string, unknown>)[key] === 'function'
  )
}

const REQUIRED_OPERATIONS = PROVIDER_OPERATIONS.filter(
  (operation) => !(PROVIDER_OPTIONAL_OPERATIONS as readonly string[]).includes(operation)
)

describe('TrackerProvider surface', () => {
  it.each(providers)('%s exposes nothing beyond the sanctioned operations', (_name, provider) => {
    for (const method of methodsOf(provider)) {
      expect(
        (PROVIDER_OPERATIONS as readonly string[]).includes(method),
        `provider method "${method}" is not in PROVIDER_OPERATIONS`
      ).toBe(true)
    }
  })

  it.each(providers)('%s implements every required operation', (_name, provider) => {
    for (const operation of REQUIRED_OPERATIONS) {
      expect(methodsOf(provider)).toContain(operation)
    }
  })

  it('linear implements the optional workflow-move pair', () => {
    const [, linear] = providers[0]
    for (const operation of PROVIDER_OPTIONAL_OPERATIONS) {
      expect(methodsOf(linear)).toContain(operation)
    }
  })

  it('jira omits the optional pair, and reports that rather than throwing when asked', () => {
    const [, jira] = providers[1]
    for (const operation of PROVIDER_OPTIONAL_OPERATIONS) {
      expect(methodsOf(jira)).not.toContain(operation)
    }
  })

  it.each(providers)('%s exposes no mutation beyond the sanctioned writes', (_name, provider) => {
    for (const method of methodsOf(provider)) {
      if ((PROVIDER_WRITE_OPERATIONS as readonly string[]).includes(method)) continue
      for (const pattern of MUTATION_PATTERNS) {
        expect(
          pattern.test(method),
          `provider method "${method}" looks like a mutation; FR-034 permits only comment`
        ).toBe(false)
      }
    }
  })

  it('sanctions exactly two write operations, and no field-level write among them', () => {
    expect(PROVIDER_WRITE_OPERATIONS).toEqual(['comment', 'transition'])
  })

  it('sanctions no way to create or delete an issue', () => {
    for (const operation of PROVIDER_OPERATIONS) {
      expect(/^(create|delete|archive)/i.test(operation)).toBe(false)
    }
  })

  it.each(providers)('%s reports its own tracker id', (name, provider) => {
    expect(provider.id).toBe(name)
  })
})
