import { describe, it, expect } from 'vitest'
import { coreAsksFrom, finishedFacts } from '../../../../src/renderer/home/core-asks'
import { fact } from '../sidebar/fixtures/facts'

const titles = new Map([['linear:TAV-31', 'Rate limit']])
const agent = {
  provider: 'claude',
  sessionId: 'c1',
  transcriptPath: '/t',
  cwd: '/r',
  capturedAt: 'x',
} as never

const numberedPrompt = {
  question: 'Overwrite?',
  options: [
    { number: 1, label: 'Yes' },
    { number: 2, label: 'No' },
  ],
}

describe('coreAsksFrom: awaiting input', () => {
  it('turns a numbered prompt into answer actions 1..n plus reply', () => {
    const [ask] = coreAsksFrom(
      [
        fact({
          sessionId: 's9',
          workspaceName: 'terminator',
          projectName: 'main',
          state: 'awaiting-input',
          lastActivityAt: 1000,
          choicePrompt: numberedPrompt,
          workItem: { source: 'project', ref: { tracker: 'linear', key: 'TAV-31' } },
        }),
      ],
      titles
    )
    expect(ask.id).toBe('core:answer:s9:1000')
    expect(ask.detail).toBe('Overwrite?')
    expect(ask.choices).toEqual(numberedPrompt.options)
    expect(ask.actions.map((a) => a.id)).toEqual(['choice-1', 'choice-2', 'reply'])
    expect(ask.where).toBe('terminator · TAV-31 Rate limit')
    expect(ask.open.args).toEqual({ sessionId: 's9' })
  })
})

describe('coreAsksFrom: where the work is', () => {
  const where = (patch: Parameters<typeof fact>[0]) => coreAsksFrom([fact(patch)], titles)[0]

  it('names the tab when the workspace has no ticket and no branch', () => {
    const ask = where({ state: 'awaiting-input', branch: null, name: 'terminal 3' })
    expect(ask.where).toBe('Personal · terminal 3')
  })

  it('names its work even for a scratch terminal with nothing to show', () => {
    const ask = where({
      state: 'idle',
      agent,
      lastActivityAt: 500,
      workspaceName: null,
      branch: null,
      name: 'terminal 3',
      latestLine: 'Done',
    })
    expect(ask.where).toBe('Scratch terminal · tab “terminal 3”')
    expect(ask.detail).toBe('Last output: Done')
  })
})

describe('coreAsksFrom: awaiting input without a prompt', () => {
  it('uses the free-text ask message, then the latest line, when there is no prompt', () => {
    const base = { state: 'awaiting-input' as const, latestLine: 'last line' }
    expect(coreAsksFrom([fact({ ...base, askMessage: 'Allow Bash?' })], titles)[0].detail).toBe(
      'Allow Bash?'
    )
    expect(coreAsksFrom([fact(base)], titles)[0].detail).toBe('last line')
    expect(coreAsksFrom([fact(base)], titles)[0].actions).toEqual([
      { id: 'reply', label: 'Reply', primary: true },
    ])
  })

  it('gives a new wait a new id', () => {
    const wait = (at: number) =>
      coreAsksFrom([fact({ state: 'awaiting-input', lastActivityAt: at })], titles)[0].id
    expect(wait(1)).not.toBe(wait(2))
  })
})

describe('coreAsksFrom: finished while away', () => {
  const finished = { state: 'idle' as const, agent, lastActivityAt: 500, branch: 'tav-31' }

  it('raises a finished ask for an agent that went idle after you last looked', () => {
    const [ask] = coreAsksFrom(
      [fact({ ...finished, lastAttendedAt: 100, description: 'Add limits' })],
      titles
    )
    expect(ask).toMatchObject({ kind: 'finished', title: 'Agent finished', detail: 'Add limits' })
    expect(ask.actions.map((a) => a.id)).toEqual(['review-changes'])
  })

  it('falls back to the last output, then the branch, when there is no description', () => {
    expect(
      coreAsksFrom([fact({ ...finished, latestLine: 'All tests pass' })], titles)[0].detail
    ).toBe('Last output: All tests pass')
    expect(coreAsksFrom([fact(finished)], titles)[0].detail).toBe('tav-31')
  })

  it('raises nothing when the session was attended after it finished', () => {
    expect(coreAsksFrom([fact({ ...finished, lastAttendedAt: 600 })], titles)).toEqual([])
  })

  it('raises nothing for a plain shell, a closed session or a working agent', () => {
    expect(coreAsksFrom([fact({ ...finished, agent: null })], titles)).toEqual([])
    expect(coreAsksFrom([fact({ ...finished, isClosed: true })], titles)).toEqual([])
    expect(coreAsksFrom([fact({ ...finished, state: 'working' })], titles)).toEqual([])
  })
})

describe('finishedFacts', () => {
  it('counts files and lines', () => {
    expect(finishedFacts({ files: 4, added: 210, removed: 8 })).toEqual(['4 files', '+210 −8'])
    expect(finishedFacts({ files: 1, added: 1, removed: 0 })[0]).toBe('1 file')
  })
  it('says nothing for no changes', () => {
    expect(finishedFacts(null)).toEqual([])
    expect(finishedFacts({ files: 0, added: 0, removed: 0 })).toEqual([])
  })
})

describe('coreAsksFrom: told or guessed', () => {
  it('marks an answer inferred when a bell or a screen choice raised it, not when the agent did', () => {
    const [guessed] = coreAsksFrom(
      [fact({ state: 'awaiting-input', askInferred: true, askSignal: 'bell' })],
      titles
    )
    const [told] = coreAsksFrom([fact({ state: 'awaiting-input', askMessage: 'Allow?' })], titles)
    expect(guessed.inferred).toBe(true)
    expect(told.inferred).toBeUndefined()
  })
})
