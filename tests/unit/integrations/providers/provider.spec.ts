import { describe, it, expect } from 'vitest'
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

/** The complete set of operations a provider may expose. */
const PROVIDER_OPERATIONS = [
  'verify',
  'listMine',
  'search',
  'get',
  'comment',
  'states',
  'transition',
  'teams',
  'create',
] as const

/** The operations permitted to write to a tracker. `transition` moves an issue
 * along its own workflow and can do nothing else; `create` files a new issue the
 * operator asked for (ADR-061); neither can set a field of an existing one. */
const PROVIDER_WRITE_OPERATIONS = ['comment', 'transition', 'create'] as const

/** What a provider may expose but need not: callers ask the issue service first. */
const PROVIDER_OPTIONAL_OPERATIONS = ['states', 'transition', 'teams', 'create'] as const

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

  it('linear implements every optional operation', () => {
    const [, linear] = providers[0]
    for (const operation of PROVIDER_OPTIONAL_OPERATIONS) {
      expect(methodsOf(linear)).toContain(operation)
    }
  })
})

describe('TrackerProvider optional operations and writes', () => {
  // Asked about one, the issue service answers "unsupported" (issue-service-transition.spec).
  it('jira omits every optional operation', () => {
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

  it('sanctions no way to delete or archive an issue', () => {
    for (const operation of PROVIDER_OPERATIONS) {
      expect(/^(delete|archive)/i.test(operation)).toBe(false)
    }
  })

  it.each(providers)('%s reports its own tracker id', (name, provider) => {
    expect(provider.id).toBe(name)
  })
})
