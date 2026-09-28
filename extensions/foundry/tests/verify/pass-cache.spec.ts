import { describe, it, expect, vi } from 'vitest'
import { createPassCache } from '../../src/verify/pass-cache.js'

function git(state: { head: string; dirty: boolean }) {
  return vi.fn(async (args: string[]) => {
    if (args[0] === 'rev-parse') return { exitCode: 0, stdout: `${state.head}\n` }
    if (args[0] === 'status') return { exitCode: 0, stdout: state.dirty ? ' M src/a.ts\n' : '' }
    return { exitCode: 1, stdout: '' }
  })
}

describe('createPassCache', () => {
  it('remembers a command that passed on a clean commit', async () => {
    const cache = createPassCache(git({ head: 'abc', dirty: false }))
    await cache.record('/wt', 'npm run lint', 0)
    expect(await cache.passed('/wt', 'npm run lint')).toBe(true)
  })

  it('forgets it once the commit changes', async () => {
    const state = { head: 'abc', dirty: false }
    const cache = createPassCache(git(state))
    await cache.record('/wt', 'npm run lint', 0)
    state.head = 'def'
    expect(await cache.passed('/wt', 'npm run lint')).toBe(false)
  })

  it('never trusts a pass while there are uncommitted changes', async () => {
    const state = { head: 'abc', dirty: true }
    const cache = createPassCache(git(state))
    await cache.record('/wt', 'npm run lint', 0)
    state.dirty = false
    expect(await cache.passed('/wt', 'npm run lint')).toBe(false)
    await cache.record('/wt', 'npm run lint', 0)
    state.dirty = true
    expect(await cache.passed('/wt', 'npm run lint')).toBe(false)
  })

  it('does not remember a failure, or a different command', async () => {
    const cache = createPassCache(git({ head: 'abc', dirty: false }))
    await cache.record('/wt', 'npm test', 1)
    await cache.record('/wt', 'npm run lint', 0)
    expect(await cache.passed('/wt', 'npm test')).toBe(false)
    expect(await cache.passed('/wt', 'npm run format')).toBe(false)
  })

  it('treats a checkout git cannot read as never passed', async () => {
    const cache = createPassCache(vi.fn(async () => ({ exitCode: 128, stdout: '' })))
    await cache.record('/wt', 'npm run lint', 0)
    expect(await cache.passed('/wt', 'npm run lint')).toBe(false)
  })
})
