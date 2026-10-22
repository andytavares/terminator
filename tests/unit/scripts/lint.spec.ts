import { describe, it, expect } from 'vitest'
import { lintRuns } from '../../../scripts/lint.mjs'

// Typed lint holds a TypeScript program per project; one process for the whole repository held
// all of them (4.8 GB) and CI's 7 GB runner swapped for eight minutes. One process per group.
describe('the lint runs', () => {
  const runs = lintRuns(['foundry', 'notepad'])

  it('lints each group of test projects in a process of its own', () => {
    expect(runs.slice(0, -1)).toEqual([
      ['tests'],
      ['src'],
      ['packages'],
      ['extensions/foundry'],
      ['extensions/notepad'],
    ])
  })

  it('lints everything else last, leaving out only what a group already linted', () => {
    expect(runs.at(-1)).toEqual([
      '.',
      ...['tests', 'src', 'packages', 'extensions/foundry', 'extensions/notepad'].flatMap(
        (group) => ['--ignore-pattern', `${group}/**`]
      ),
    ])
  })
})
