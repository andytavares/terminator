import { describe, it, expect } from 'vitest'
import { parseGitLog, artifactSpecs, buildArtifactRef } from '../../src/state/artifact-list.js'

describe('parseGitLog', () => {
  it('parses tab-separated commit/date/subject lines', () => {
    const out = 'abc123\t2026-06-30T00:00:00Z\tAdd spec\ndef456\t2026-06-29T00:00:00Z\tInitial'
    const revs = parseGitLog(out)
    expect(revs).toHaveLength(2)
    expect(revs[0]).toEqual({ commit: 'abc123', ts: '2026-06-30T00:00:00Z', subject: 'Add spec' })
  })

  it('ignores blank lines', () => {
    expect(parseGitLog('\n\n')).toEqual([])
  })
})

describe('artifactSpecs', () => {
  it('lists the seven known artifact kinds in order', () => {
    expect(artifactSpecs().map((s) => s.kind)).toEqual([
      'spec',
      'plan',
      'tasks',
      'checklist',
      'self-review',
      'diff',
      'pr',
    ])
  })
})

describe('buildArtifactRef', () => {
  it('uses file existence for file-backed artifacts', () => {
    const spec = artifactSpecs()[0]
    const ref = buildArtifactRef(spec, { exists: true, revisions: [] })
    expect(ref.exists).toBe(true)
    expect(ref.path).toBe('spec.md')
    expect(ref.prUrl).toBeUndefined()
  })

  it('derives PR existence from the prUrl', () => {
    const spec = artifactSpecs().find((s) => s.kind === 'pr')!
    expect(buildArtifactRef(spec, { exists: false, revisions: [] }).exists).toBe(false)
    const withPr = buildArtifactRef(spec, {
      exists: false,
      revisions: [],
      prUrl: 'https://github.com/x/y/pull/1',
    })
    expect(withPr.exists).toBe(true)
    expect(withPr.prUrl).toContain('pull/1')
  })
})
