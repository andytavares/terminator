import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { readSelfReviewSummary } from '../../src/state/self-review-summary.js'

// Every number here comes from a tool's own machine-readable report. Nothing a
// tool did not report is filled in: a zero would read as "no errors", and a
// review that says that when it does not know is worse than one that says
// nothing.

let dir: string

const code = (id: string, value: number) => writeFileSync(join(dir, `${id}.code`), `${value}\n`)

const lintReport = (files: Array<{ errorCount: number; warningCount: number }>) =>
  writeFileSync(join(dir, 'lint.json'), JSON.stringify(files))

function coverage(pct: number): void {
  mkdirSync(join(dir, 'coverage'), { recursive: true })
  writeFileSync(
    join(dir, 'coverage', 'coverage-summary.json'),
    JSON.stringify({ total: { lines: { pct } } })
  )
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'self-review-summary-'))
})

afterEach(() => rmSync(dir, { recursive: true, force: true }))

describe('when the checks left nothing behind', () => {
  it('reports nothing rather than a result that says everything passed', () => {
    // A phase that never ran and one where everything passed must not look the
    // same; the gate already says where to read the output when there is none.
    expect(readSelfReviewSummary(dir)).toBeNull()
  })
})

describe('reading what each check recorded', () => {
  it('passes a step that exited zero', () => {
    code('format', 0)
    expect(readSelfReviewSummary(dir)?.format.passed).toBe(true)
  })

  it('fails one that did not', () => {
    code('format', 1)
    expect(readSelfReviewSummary(dir)?.format.passed).toBe(false)
  })

  it('says nothing about a step that recorded no code at all', () => {
    // Not a pass, and not a failure it can be blamed for either.
    code('format', 0)
    expect(readSelfReviewSummary(dir)?.lint.passed).toBeNull()
  })

  it('ignores a code file that is not a number', () => {
    code('format', 0)
    writeFileSync(join(dir, 'lint.code'), 'killed\n')
    expect(readSelfReviewSummary(dir)?.lint.passed).toBeNull()
  })
})

describe('the numbers', () => {
  it('totals eslint’s counts across every file', () => {
    code('lint', 1)
    lintReport([
      { errorCount: 2, warningCount: 3 },
      { errorCount: 1, warningCount: 0 },
    ])
    const result = readSelfReviewSummary(dir)
    expect(result?.lint.errorCount).toBe(3)
    expect(result?.lint.warningCount).toBe(3)
  })

  it('reports no counts rather than zero when the report is missing', () => {
    code('lint', 0)
    expect(readSelfReviewSummary(dir)?.lint.errorCount).toBeNull()
  })

  it('reports no counts rather than zero when the report is not what was expected', () => {
    code('lint', 0)
    writeFileSync(join(dir, 'lint.json'), '{"not":"an array"}')
    expect(readSelfReviewSummary(dir)?.lint.errorCount).toBeNull()
  })

  it('takes line coverage from the summary the reporter wrote', () => {
    code('test', 0)
    coverage(87.5)
    expect(readSelfReviewSummary(dir)?.coverage.percentage).toBe(87.5)
  })

  it('reports no percentage rather than zero when coverage was not written', () => {
    code('test', 0)
    expect(readSelfReviewSummary(dir)?.coverage.percentage).toBeNull()
  })

  it('never claims a blocker count — the review writes prose, not a number', () => {
    code('review', 0)
    expect(readSelfReviewSummary(dir)?.googleReview.blockerCount).toBeNull()
  })
})

describe('the sentence at the bottom', () => {
  it('says everything that ran passed', () => {
    for (const id of ['format', 'lint', 'test', 'review']) code(id, 0)
    expect(readSelfReviewSummary(dir)?.summary).toBe('Every check that ran passed.')
  })

  it('names what failed', () => {
    code('format', 0)
    code('lint', 1)
    code('test', 1)
    expect(readSelfReviewSummary(dir)?.summary).toContain('Failed: lint, test.')
  })

  it('names what never ran, rather than counting it as passing', () => {
    code('format', 0)
    expect(readSelfReviewSummary(dir)?.summary).toContain('Did not run: lint, test, review.')
  })
})

describe('the captured output', () => {
  it('is null, because each step streams to the console instead', () => {
    // Capturing per step would mean piping, and reading a pipe's status is not
    // the same variable in bash and zsh — the live view is worth more.
    code('format', 0)
    expect(readSelfReviewSummary(dir)?.format.output).toBeNull()
  })
})
