import { describe, expect, it } from 'vitest'
import { selectSpecs } from '../../../scripts/e2e-select.mjs'

const SPECS = [
  'terminal.spec.ts',
  'settings.spec.ts',
  'foundry-forge.spec.ts',
  'git-commit-flow.spec.ts',
  'merge-flow.spec.ts',
  'pr-review-diff.spec.ts',
  'review-agent.spec.ts',
  'notepad-notes.spec.ts',
  'task-vault-today.spec.ts',
  'remote-control.spec.ts',
]

describe('the e2e specs a change reaches', () => {
  it('runs every spec when a core package is affected', () => {
    expect(selectSpecs(['@terminator/core-renderer'], SPECS)).toEqual(SPECS)
  })

  it.each([
    '//',
    '@terminator/extension-sdk',
    '@terminator/extension-ui',
    '@terminator/test-support',
  ])('runs every spec when %s is affected', (name) => {
    expect(selectSpecs([name], SPECS)).toEqual(SPECS)
  })

  it('runs only the specs of an affected extension', () => {
    expect(selectSpecs(['@terminator/extension-git-integration'], SPECS)).toEqual([
      'git-commit-flow.spec.ts',
      'merge-flow.spec.ts',
      'pr-review-diff.spec.ts',
      'review-agent.spec.ts',
    ])
  })
})

describe('the e2e specs an extension-only change reaches', () => {
  it('joins the specs of two affected extensions', () => {
    expect(
      selectSpecs(['@terminator/extension-notepad', '@terminator/extension-task-vault'], SPECS)
    ).toEqual(['notepad-notes.spec.ts', 'task-vault-today.spec.ts'])
  })

  it('runs no spec when only termctl is affected, which the app does not load', () => {
    expect(selectSpecs(['@terminator/termctl'], SPECS)).toEqual([])
  })

  it('runs no spec when nothing is affected', () => {
    expect(selectSpecs([], SPECS)).toEqual([])
  })
})
