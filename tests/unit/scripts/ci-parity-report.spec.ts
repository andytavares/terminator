import { describe, it, expect } from 'vitest'
import { flips, parityBreaks, rowsFromRuns } from '../../../scripts/ci-parity-report.mjs'

const runs = [
  {
    databaseId: 1,
    headSha: 'aaa',
    jobs: [
      { name: 'Unit', conclusion: 'failure' },
      { name: 'Lint', conclusion: 'success' },
    ],
  },
  { databaseId: 2, headSha: 'aaa', jobs: [{ name: 'Unit', conclusion: 'success' }] },
  { databaseId: 3, headSha: 'bbb', jobs: [{ name: 'Lint', conclusion: 'failure' }] },
]

describe('rowsFromRuns', () => {
  it('has one row per job, carrying its run and head commit', () => {
    expect(rowsFromRuns(runs)).toContainEqual({
      runId: 1,
      sha: 'aaa',
      job: 'Unit',
      conclusion: 'failure',
    })
    expect(rowsFromRuns(runs)).toHaveLength(4)
  })
})

describe('parityBreaks', () => {
  it('lists a failed job whose commit had a local-check success', () => {
    const breaks = parityBreaks(rowsFromRuns(runs), new Set(['aaa']))
    expect(breaks).toEqual([{ runId: 1, sha: 'aaa', job: 'Unit', conclusion: 'failure' }])
  })

  it('lists nothing for a failure on a commit ci:local never passed', () => {
    expect(parityBreaks(rowsFromRuns(runs), new Set())).toEqual([])
  })
})

describe('flips', () => {
  it('lists a commit and job that both failed and passed', () => {
    expect(flips(rowsFromRuns(runs))).toEqual([{ sha: 'aaa', job: 'Unit' }])
  })

  it('does not list a job that only ever failed', () => {
    expect(flips(rowsFromRuns(runs.slice(2)))).toEqual([])
  })
})
