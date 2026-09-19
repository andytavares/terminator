import { describe, it, expect } from 'vitest'
import { expandVariables } from '../../../../src/renderer/quick-actions/variables'

describe('expandVariables', () => {
  it('replaces every known variable', () => {
    const result = expandVariables('cd {cwd} on {branch} in {repo}', {
      cwd: '/work/tree',
      branch: 'feat/x',
      repo: 'terminator',
    })
    expect(result).toEqual({ ok: true, text: 'cd /work/tree on feat/x in terminator' })
  })

  it('leaves an unknown variable literal', () => {
    const result = expandVariables('echo {nope}', {})
    expect(result).toEqual({ ok: true, text: 'echo {nope}' })
  })

  it('fails with a named reason when cwd is missing', () => {
    expect(expandVariables('{cwd}', {})).toEqual({ ok: false, reason: 'No working directory' })
  })

  it('fails with a named reason when branch is null', () => {
    expect(expandVariables('{branch}', { branch: null })).toEqual({
      ok: false,
      reason: 'No branch focused',
    })
  })

  it('fails with a named reason when worktree is empty string', () => {
    expect(expandVariables('{worktree}', { worktree: '' })).toEqual({
      ok: false,
      reason: 'No worktree focused',
    })
  })

  it('fails with a named reason when repo is missing', () => {
    expect(expandVariables('{repo}', {})).toEqual({ ok: false, reason: 'No repository focused' })
  })

  it('fails with a named reason when issue is missing', () => {
    expect(expandVariables('{issue}', {})).toEqual({ ok: false, reason: 'No linked issue' })
  })

  it('fails with a named reason when selection is missing', () => {
    expect(expandVariables('{selection}', {})).toEqual({ ok: false, reason: 'No text selected' })
  })

  it('never substitutes an empty string, even amid other successful replacements', () => {
    const result = expandVariables('{cwd} {branch}', { cwd: '/x', branch: '' })
    expect(result).toEqual({ ok: false, reason: 'No branch focused' })
  })

  it('returns the body unchanged when it has no variables', () => {
    expect(expandVariables('echo hi', {})).toEqual({ ok: true, text: 'echo hi' })
  })
})
