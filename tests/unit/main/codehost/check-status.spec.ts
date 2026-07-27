import { describe, it, expect, vi } from 'vitest'
import { resolveCheckState } from '../../../../src/main/codehost/check-status.js'

// FR-057: check state resolves to `unavailable` — never `passing` — whenever
// the code host cannot actually tell us. P3, and therefore unattended merge,
// hangs off this being right.

const ok = (stdout: string) => vi.fn().mockResolvedValue({ ok: true, stdout, stderr: '' })

describe('reading check results', () => {
  it('reports passing when every check succeeded', async () => {
    const run = ok(JSON.stringify([{ state: 'SUCCESS' }, { state: 'SUCCESS' }]))
    await expect(resolveCheckState('/repo', 'feat/x', run)).resolves.toBe('passing')
  })

  it('reports failing when any check failed', async () => {
    const run = ok(JSON.stringify([{ state: 'SUCCESS' }, { state: 'FAILURE' }]))
    await expect(resolveCheckState('/repo', 'feat/x', run)).resolves.toBe('failing')
  })

  it('reports pending when any check has not finished', async () => {
    const run = ok(JSON.stringify([{ state: 'SUCCESS' }, { state: 'PENDING' }]))
    await expect(resolveCheckState('/repo', 'feat/x', run)).resolves.toBe('pending')
  })

  it('prefers failing over pending when both are present', async () => {
    const run = ok(JSON.stringify([{ state: 'FAILURE' }, { state: 'PENDING' }]))
    await expect(resolveCheckState('/repo', 'feat/x', run)).resolves.toBe('failing')
  })

  it('treats an empty check list as unavailable, not as passing', async () => {
    // No checks configured tells us nothing about whether the change is safe.
    await expect(resolveCheckState('/repo', 'feat/x', ok('[]'))).resolves.toBe('unavailable')
  })
})

describe('the fail-safe direction (FR-057)', () => {
  it('reports unavailable when gh is missing', async () => {
    const run = vi.fn().mockResolvedValue({ ok: false, stdout: '', stderr: 'command not found' })
    await expect(resolveCheckState('/repo', 'feat/x', run)).resolves.toBe('unavailable')
  })

  it('reports unavailable when gh is not authenticated', async () => {
    const run = vi
      .fn()
      .mockResolvedValue({ ok: false, stdout: '', stderr: 'gh auth login required' })
    await expect(resolveCheckState('/repo', 'feat/x', run)).resolves.toBe('unavailable')
  })

  it('reports unavailable when the host is unreachable', async () => {
    const run = vi.fn().mockRejectedValue(new Error('ENOTFOUND api.github.com'))
    await expect(resolveCheckState('/repo', 'feat/x', run)).resolves.toBe('unavailable')
  })

  it('reports unavailable for unparseable output rather than guessing', async () => {
    await expect(resolveCheckState('/repo', 'feat/x', ok('not json'))).resolves.toBe('unavailable')
  })

  it('reports unavailable when the output is not a list of checks', async () => {
    await expect(resolveCheckState('/repo', 'feat/x', ok('{"unexpected":true}'))).resolves.toBe(
      'unavailable'
    )
  })

  it('never returns passing from any failure path', async () => {
    const failures = [
      vi.fn().mockResolvedValue({ ok: false, stdout: '', stderr: 'x' }),
      vi.fn().mockRejectedValue(new Error('boom')),
      ok('garbage'),
      ok('[]'),
    ]
    for (const run of failures) {
      await expect(resolveCheckState('/repo', 'feat/x', run)).resolves.not.toBe('passing')
    }
  })
})

describe('invocation', () => {
  it('asks the code host about the right branch, in the right repository', async () => {
    const run = ok('[]')
    await resolveCheckState('/repo', 'feat/x', run)
    const [command, args, cwd] = run.mock.calls[0]
    expect(command).toBe('gh')
    expect(args).toContain('feat/x')
    expect(cwd).toBe('/repo')
  })
})
