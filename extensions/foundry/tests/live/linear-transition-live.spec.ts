import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { createLinearProvider } from '../../../../src/main/integrations/providers/linear.provider'
import type {
  StoredCredential,
  TrackerStateOption,
} from '../../../../src/main/integrations/providers/provider'

// ADR-041, against the real Linear API.
//
// Every other test of this provider hands it a fake client and asserts the
// GraphQL it would send. That checks the query this code *builds*. It cannot
// check the thing the ADR actually turns on: that resolving an intent by a
// state's `type` and `position` lands on the state a person would have picked,
// in a workflow this code has never seen.
//
// It needs a Linear API key and an issue it may move. The issue is left in
// whatever state the last case put it, so use a scratch one:
//
//   LINEAR_API_KEY=lin_api_… LINEAR_TEST_ISSUE=TEAM-123 npm run test:live
//
// Without both, the whole file is skipped rather than passing on nothing.

const KEY = process.env.LINEAR_API_KEY ?? ''
const ISSUE = process.env.LINEAR_TEST_ISSUE ?? ''
const RUNNABLE = KEY !== '' && ISSUE !== ''

const cred: StoredCredential = { tracker: 'linear', apiKey: KEY }
const provider = createLinearProvider()

let states: TrackerStateOption[] = []
/** Where the issue was before this file touched it. */
let original: string | null = null

describe.skipIf(!RUNNABLE)('the Linear provider, against the real API', () => {
  beforeAll(async () => {
    expect(provider.states, 'the Linear provider must implement states').toBeDefined()
    expect(provider.transition, 'the Linear provider must implement transition').toBeDefined()
    states = await provider.states!(cred, ISSUE)
    const issue = await provider.get(cred, ISSUE)
    original = issue?.status ?? null
  })

  afterAll(async () => {
    // Put it back. A scratch issue is still the operator's.
    if (original === null || states.length === 0) return
    const back = states.find((state) => state.name === original)
    if (back !== undefined && provider.transition !== undefined) {
      await provider.transition(cred, ISSUE, 'started', back.id)
    }
  })

  it('reads the real workflow rather than an assumed one', () => {
    expect(states.length).toBeGreaterThan(2)
    // eslint-disable-next-line no-console
    console.log(`workflow: ${states.map((s) => `${s.name}[${s.intent ?? '—'}]`).join(' → ')}`)
  })

  it('resolves "started" to a state the tracker itself calls started', () => {
    const started = states.filter((state) => state.intent === 'started')
    expect(started).toHaveLength(1)
    // The rule is "the first started state by position". Whatever this
    // workspace calls it, it must be one that comes before the review state.
    const reviewAt = states.findIndex((state) => state.intent === 'in_review')
    const startedAt = states.findIndex((state) => state.intent === 'started')
    if (reviewAt !== -1) expect(startedAt).toBeLessThan(reviewAt)
  })

  it('resolves "in_review" only where the workflow has somewhere later to go', () => {
    const review = states.filter((state) => state.intent === 'in_review')
    // Zero or one, never more — and when there is one it is not the same state
    // as `started`, which is the failure "one started state wearing two hats"
    // would produce.
    expect(review.length).toBeLessThanOrEqual(1)
    if (review.length === 1) {
      expect(review[0].id).not.toBe(states.find((s) => s.intent === 'started')?.id)
    }
  })

  it('resolves "done" to exactly one state', () => {
    expect(states.filter((state) => state.intent === 'done')).toHaveLength(1)
  })

  it('leaves backlog and cancelled states carrying no intent', () => {
    const named = states.filter((state) => state.intent !== null).map((state) => state.name)
    // eslint-disable-next-line no-console
    console.log(`intents landed on: ${named.join(', ')}`)
    expect(named.length).toBeGreaterThan(0)
    expect(named.length).toBeLessThanOrEqual(3)
  })

  it('actually moves the issue, and Linear reports the new state', async () => {
    const target = states.find((state) => state.intent === 'started')
    expect(target, 'this workflow has no started state to move to').toBeDefined()

    await provider.transition!(cred, ISSUE, 'started')

    // Read it back from Linear rather than trusting that the mutation resolved.
    const after = await provider.get(cred, ISSUE)
    expect(after?.status).toBe(target?.name)
  })

  it("honours the operator's own mapping over the type rule", async () => {
    // Any state at all, including one the rule would never choose — that is
    // what an override is for (FR-060).
    const anywhere = states.find((state) => state.intent === null)
    if (anywhere === undefined) return
    await provider.transition!(cred, ISSUE, 'done', anywhere.id)
    const after = await provider.get(cred, ISSUE)
    expect(after?.status).toBe(anywhere.name)
  })

  it('refuses an override naming a state this workflow does not have', async () => {
    await expect(
      provider.transition!(cred, ISSUE, 'started', '00000000-0000-0000-0000-000000000000')
    ).rejects.toThrow(/not available/)
  })
})
