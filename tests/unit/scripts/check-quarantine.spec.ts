import { describe, it, expect } from 'vitest'
import { quarantineProblems } from '../../../scripts/check-quarantine.mjs'

const FOUNDRY_SPEC = 'extensions/foundry/tests/components/App.spec.tsx'
const FOUNDRY_TEST = `${FOUNDRY_SPEC} > the Factory view toggle > a shaping order > sends a shaping order back to the list, open`
const entry = {
  test: FOUNDRY_TEST,
  kind: 'unit',
  issue: 301,
  quarantined: '2026-10-20',
  expires: '2026-10-27',
}
const MOVES = 'fix the cause and remove the tag, or delete the test with the behaviour it covered'
const onBase = () => true
const check = (overrides: Record<string, unknown> = {}) =>
  quarantineProblems({
    entries: [entry],
    tagged: [FOUNDRY_TEST],
    today: '2026-10-23',
    onBase,
    changedFiles: [],
    ...overrides,
  })

describe('quarantineProblems', () => {
  it('reports nothing for one listed, tagged, unexpired test that exists on the base', () => {
    expect(check()).toEqual([])
  })

  it('reports a tagged test with no entry', () => {
    expect(check({ entries: [] })).toEqual([
      `${FOUNDRY_TEST}: tagged quarantine but not listed in tests/quarantine.json; ${MOVES}`,
    ])
  })

  it('reports an entry whose test is no longer tagged', () => {
    expect(check({ tagged: [] })).toEqual([
      `${FOUNDRY_TEST} (issue 301): listed in tests/quarantine.json but no test carries the tag; ${MOVES}`,
    ])
  })
})

describe('quarantineProblems dating rules', () => {
  it('reports a quarantine longer than 7 days', () => {
    const long = { ...entry, expires: '2026-10-28' }
    expect(check({ entries: [long] })).toEqual([
      `${FOUNDRY_TEST} (issue 301): expires more than 7 days after it was quarantined; ${MOVES}`,
    ])
  })

  it('allows a quarantine of exactly 7 days', () => {
    expect(check({ today: '2026-10-27' })).toEqual([])
  })

  it('reports an expired quarantine', () => {
    expect(check({ today: '2026-10-28' })).toEqual([
      `${FOUNDRY_TEST} (issue 301): expired on 2026-10-27; ${MOVES}`,
    ])
  })
})

describe('quarantineProblems size and change rules', () => {
  it('reports each entry past the limit of 5', () => {
    const entries = Array.from({ length: 6 }, (_, index) => ({
      ...entry,
      test: `tests/unit/a${index}.spec.ts > case`,
      issue: 400 + index,
    }))
    const problems = quarantineProblems({
      entries,
      tagged: entries.map((each) => each.test),
      today: '2026-10-23',
      onBase,
      changedFiles: [],
    })
    expect(problems).toEqual([
      `tests/unit/a5.spec.ts > case (issue 405): more than 5 tests are quarantined; ${MOVES}`,
    ])
  })
})

describe('quarantineProblems base and change rules', () => {
  it('reports a test the base branch does not hold', () => {
    const problems = check({ onBase: () => false })
    expect(problems).toEqual([
      `${FOUNDRY_TEST} (issue 301): not on the base branch, and a new test cannot start in quarantine, it must pass the stability gate; ${MOVES}`,
    ])
  })

  it('asks the base for the spec file and the title inside it', () => {
    const asked: string[][] = []
    check({
      onBase: (file: string, title: string) => {
        asked.push([file, title])
        return true
      },
    })
    expect(asked).toEqual([
      [
        FOUNDRY_SPEC,
        'the Factory view toggle > a shaping order > sends a shaping order back to the list, open',
      ],
    ])
  })

  it('reports a change that edits a quarantined spec file and keeps the tag', () => {
    expect(check({ changedFiles: [FOUNDRY_SPEC, 'README.md'] })).toEqual([
      `${FOUNDRY_TEST} (issue 301): this change edits ${FOUNDRY_SPEC} and leaves the test in quarantine; ${MOVES}`,
    ])
  })
})
