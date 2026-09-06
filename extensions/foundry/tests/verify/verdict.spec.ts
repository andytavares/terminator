import { describe, it, expect } from 'vitest'
import {
  makeVerdict,
  verdictFromExit,
  isPass,
  summarise,
  SelfVerificationError,
  UnevidencedVerdictError,
} from '../../src/verify/verdict.js'
import type { Verdict } from '../../src/verify/verdict.js'

// Two things are enforced here rather than asked for, because a rule that
// lives only in a prompt is one the next model may reinterpret: nothing marks
// its own homework, and "not measured" is never a pass.

function base() {
  return {
    nodeId: 'build:U-1',
    criterionId: 'AC-1',
    nodeSessionId: 'sess-builder',
    producedBy: { role: 'verifier', sessionId: 'sess-verifier' },
    at: '2026-09-06T10:00:00.000Z',
  }
}

describe('makeVerdict', () => {
  it('builds a pass with evidence', () => {
    const v = makeVerdict({
      ...base(),
      result: 'pass',
      reason: '',
      evidence: [{ kind: 'exit_code', exitCode: 0 }],
    })
    expect(v.result).toBe('pass')
    expect(v.at).toBe('2026-09-06T10:00:00.000Z')
  })

  it('refuses a verdict from the session that did the work', () => {
    expect(() =>
      makeVerdict({
        ...base(),
        producedBy: { role: 'builder', sessionId: 'sess-builder' },
        result: 'pass',
        reason: '',
        evidence: [{ kind: 'exit_code', exitCode: 0 }],
      })
    ).toThrow(SelfVerificationError)
  })

  it('says why it refused, in words rather than a code', () => {
    expect(() =>
      makeVerdict({
        ...base(),
        producedBy: { role: 'builder', sessionId: 'sess-builder' },
        result: 'pass',
        reason: '',
        evidence: [{ kind: 'exit_code', exitCode: 0 }],
      })
    ).toThrow(/own homework/)
  })

  it('allows a verdict when the work had no session of its own', () => {
    expect(() =>
      makeVerdict({
        ...base(),
        nodeSessionId: null,
        result: 'pass',
        reason: '',
        evidence: [{ kind: 'exit_code', exitCode: 0 }],
      })
    ).not.toThrow()
  })

  it('refuses a pass that cites nothing', () => {
    expect(() => makeVerdict({ ...base(), result: 'pass', reason: '', evidence: [] })).toThrow(
      UnevidencedVerdictError
    )
  })

  it('refuses a failure that cites nothing', () => {
    expect(() =>
      makeVerdict({ ...base(), result: 'fail', reason: 'it broke', evidence: [] })
    ).toThrow(UnevidencedVerdictError)
  })

  it('refuses a failure with no reason', () => {
    expect(() =>
      makeVerdict({
        ...base(),
        result: 'fail',
        reason: '   ',
        evidence: [{ kind: 'exit_code', exitCode: 1 }],
      })
    ).toThrow(UnevidencedVerdictError)
  })

  it('allows "not measured" to cite nothing, because there was nothing to cite', () => {
    const v = makeVerdict({
      ...base(),
      result: 'not_measured',
      reason: 'no coverage command here',
      evidence: [],
    })
    expect(v.result).toBe('not_measured')
  })

  it('still requires "not measured" to say why', () => {
    expect(() =>
      makeVerdict({ ...base(), result: 'not_measured', reason: '', evidence: [] })
    ).toThrow(UnevidencedVerdictError)
  })
})

describe('isPass', () => {
  function verdict(result: Verdict['result']): Verdict {
    return {
      nodeId: 'n',
      criterionId: 'AC-1',
      result,
      reason: 'r',
      evidence: [],
      producedBy: { role: 'verifier', sessionId: 's' },
      at: 'now',
    }
  }

  it('is true only for a pass', () => {
    expect(isPass(verdict('pass'))).toBe(true)
  })

  it('is false for a failure', () => {
    expect(isPass(verdict('fail'))).toBe(false)
  })

  it('is false for "not measured" — the whole point of the third value', () => {
    expect(isPass(verdict('not_measured'))).toBe(false)
  })
})

describe('summarise', () => {
  function verdict(criterionId: string, result: Verdict['result']): Verdict {
    return {
      nodeId: 'n',
      criterionId,
      result,
      reason: 'r',
      evidence: [],
      producedBy: { role: 'verifier', sessionId: 's' },
      at: 'now',
    }
  }

  it('counts each kind', () => {
    const s = summarise([
      verdict('AC-1', 'pass'),
      verdict('AC-2', 'fail'),
      verdict('AC-3', 'not_measured'),
    ])
    expect(s).toMatchObject({ passed: 1, failed: 1, notMeasured: 1, ok: false })
  })

  it('is ok only when everything passed', () => {
    expect(summarise([verdict('AC-1', 'pass'), verdict('AC-2', 'pass')]).ok).toBe(true)
  })

  it('is not ok when something was never measured, even with no failures', () => {
    const s = summarise([verdict('AC-1', 'pass'), verdict('AC-2', 'not_measured')])
    expect(s.failed).toBe(0)
    expect(s.ok).toBe(false)
    expect(s.unmeasuredCriteria).toEqual(['AC-2'])
  })

  it('is not ok with nothing to summarise — no verdicts is not a pass', () => {
    expect(summarise([]).ok).toBe(false)
  })
})

describe('verdictFromExit', () => {
  it('passes on a zero exit', () => {
    const v = verdictFromExit({ ...base(), command: 'npm test', exitCode: 0 })
    expect(v.result).toBe('pass')
    expect(v.evidence[0]).toEqual({ kind: 'exit_code', exitCode: 0 })
  })

  it('fails on a non-zero exit, and names the command and the code', () => {
    const v = verdictFromExit({ ...base(), command: 'npm test', exitCode: 1 })
    expect(v.result).toBe('fail')
    expect(v.reason).toContain('npm test')
    expect(v.reason).toContain('1')
  })

  it('reports a command that never ran as not measured, not as a failure', () => {
    const v = verdictFromExit({ ...base(), command: 'npm run coverage', exitCode: null })
    expect(v.result).toBe('not_measured')
    expect(v.reason).toContain('did not run here')
  })

  it('ignores what the command printed when deciding', () => {
    const printedPasses = verdictFromExit({
      ...base(),
      command: 'npm test',
      exitCode: 1,
      stdoutExcerpt: '7139 passed',
    })
    expect(printedPasses.result).toBe('fail')
  })

  it('keeps an excerpt as extra evidence without letting it decide', () => {
    const v = verdictFromExit({
      ...base(),
      command: 'npm test',
      exitCode: 0,
      stdoutExcerpt: '3 failed',
    })
    expect(v.result).toBe('pass')
    expect(v.evidence.map((e) => e.kind)).toEqual(['exit_code', 'stdout'])
  })

  it('still refuses to let the working session judge itself', () => {
    expect(() =>
      verdictFromExit({
        ...base(),
        producedBy: { role: 'builder', sessionId: 'sess-builder' },
        command: 'npm test',
        exitCode: 0,
      })
    ).toThrow(SelfVerificationError)
  })
})
