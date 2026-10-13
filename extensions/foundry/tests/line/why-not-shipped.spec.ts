import { describe, it, expect } from 'vitest'
import type { ExtensionAPI } from '@terminator/extension-sdk'

import { whyNotShipped } from '../../src/line/ship-deps.js'
import { resolveRecipe } from '../../src/recipe/resolve.js'
import { resolveSources } from '../../src/workspace-root.js'
import type { Recipe } from '../../src/recipe/parse.js'
import type { RunOutcome } from '../../src/line/executor.js'
import { partialFake } from '../../../../tests/support/fakes'

// The one sentence the ledger gets when a finished run opens nothing: the
// first thing that actually stopped it.

const host = partialFake<ExtensionAPI>({
  settings: partialFake<ExtensionAPI['settings']>({ get: () => undefined }),
  workspace: partialFake<ExtensionAPI['workspace']>({ list: () => [] }),
})

function builtInRecipe(name: string): Recipe {
  const resolved = resolveRecipe(name, resolveSources(host, '/nowhere'))
  if (!resolved.ok) throw new Error(resolved.reason)
  return resolved.resolved.value
}

const finished = partialFake<RunOutcome>({
  complete: true,
  gates: [],
  ladder: { ok: true, steps: [], stoppedAt: null, unmeasured: [] },
})

const finishedWith = (over: Record<string, unknown>): RunOutcome =>
  partialFake<RunOutcome>({ ...finished, ...over })

describe('why a finished run opened nothing', () => {
  describe('shapes and passing checks', shapesAndPassingChecksTests)
  describe('unfinished, gated, unchecked', unfinishedGatedUncheckedTests)
  describe('the failed rung', theFailedRungTests)
})

function shapesAndPassingChecksTests() {
  it('names a shape that never opens a pull request', () => {
    const direct = builtInRecipe('direct')
    // An operator's own shape with no ready-for-review gate: it answers a question.
    const question = {
      ...direct,
      id: 'question',
      steps: direct.steps.filter((step) => step.kind !== 'gate'),
    } as Recipe
    expect(whyNotShipped(question, finished)).toBe(
      'the "question" shape opens nothing — it is a question, not a change'
    )
  })

  it('admits it cannot say which check refused, when every check it knows passed', () => {
    expect(whyNotShipped(builtInRecipe('direct'), finished)).toBe(
      'it was not shippable, and this build cannot say which check said so'
    )
  })
}

function unfinishedGatedUncheckedTests() {
  it('names unfinished nodes before anything else', () => {
    expect(whyNotShipped(builtInRecipe('direct'), finishedWith({ complete: false }))).toBe(
      'not every node finished'
    )
  })

  it('names the gates holding it, in words', () => {
    const held = finishedWith({ gates: [{ rule: 'ready-for-review' }] })
    expect(whyNotShipped(builtInRecipe('direct'), held)).toMatch(/^held by /)
  })

  it('says nothing was checked when verification never ran', () => {
    expect(whyNotShipped(builtInRecipe('direct'), finishedWith({ ladder: null }))).toBe(
      'verification never ran, so nothing has been checked'
    )
  })
}

function theFailedRungTests() {
  it('names the rung that failed, or what could not be measured', () => {
    const failed = finishedWith({
      ladder: {
        ok: false,
        stoppedAt: 'test',
        unmeasured: [],
        steps: [{ name: 'unit tests', result: 'fail' }],
      },
    })
    expect(whyNotShipped(builtInRecipe('direct'), failed)).toBe(
      'verification stopped at unit tests'
    )
    const unmeasured = finishedWith({
      ladder: { ok: false, stoppedAt: null, unmeasured: ['lint', 'typecheck'], steps: [] },
    })
    expect(whyNotShipped(builtInRecipe('direct'), unmeasured)).toBe(
      'verification could not measure lint, typecheck'
    )
  })
}
