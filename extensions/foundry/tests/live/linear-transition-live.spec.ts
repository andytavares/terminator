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
    if (provider.states === undefined) throw new Error('the Linear provider must implement states')
    states = await provider.states(cred, ISSUE)
    const issue = await provider.get(cred, ISSUE)
    original = issue?.state.name ?? null
  })

  afterAll(async () => {
    // Put it back. A scratch issue is still the operator's.
    if (original === null || states.length === 0) return
    const back = states.find((state) => state.name === original)
    if (back !== undefined && provider.transition !== undefined) {
      await provider.transition(cred, ISSUE, 'started', back.id)
    }
  })

  it('actually moves the issue, and Linear reports the new state', async () => {
    const target = states.find((state) => state.intent === 'started')
    expect(target, 'this workflow has no started state to move to').toBeDefined()

    await provider.transition!(cred, ISSUE, 'started')

    // Read it back from Linear rather than trusting that the mutation resolved.
    const after = await provider.get(cred, ISSUE)
    expect(after?.state.name).toBe(target?.name)
  })
})
