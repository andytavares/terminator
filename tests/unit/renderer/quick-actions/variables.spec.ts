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
})

describe('expandVariables — a variable with no value', () => {
  it.each([
    { body: '{cwd}', vars: {}, reason: 'No working directory' },
    { body: '{branch}', vars: { branch: null }, reason: 'No branch focused' },
    { body: '{worktree}', vars: { worktree: '' }, reason: 'No worktree focused' },
    { body: '{repo}', vars: {}, reason: 'No repository focused' },
    { body: '{issue}', vars: {}, reason: 'No linked issue' },
    { body: '{selection}', vars: {}, reason: 'No text selected' },
  ])('fails expanding $body with $vars: $reason', ({ body, vars, reason }) => {
    expect(expandVariables(body, vars)).toEqual({ ok: false, reason })
  })
})

describe('expandVariables — an empty value or no variables', () => {
  it('never substitutes an empty string, even amid other successful replacements', () => {
    const result = expandVariables('{cwd} {branch}', { cwd: '/x', branch: '' })
    expect(result).toEqual({ ok: false, reason: 'No branch focused' })
  })

  it('returns the body unchanged when it has no variables', () => {
    expect(expandVariables('echo hi', {})).toEqual({ ok: true, text: 'echo hi' })
  })
})
