import { describe, it, expect } from 'vitest'
import { restack } from '../../src/line/restack.js'
import type { ExecResult, ShellExec } from '../../src/line/integrate.js'

// `gh pr update-branch --rebase` does the rebase on GitHub; the checkout is
// only brought forward afterwards, and only when it is clean.

const lane = { cwd: '/work', branch: 'lane/1', base: 'main' }

type Call = { command: string; args: string[]; timeoutMs?: number }

/** A fake exec that records every call and answers by the first two args. */
function scripted(answers: Record<string, Partial<ExecResult>>, calls: Call[] = []): ShellExec {
  return async ({ command, args, timeoutMs }) => {
    calls.push({ command, args, timeoutMs })
    const answer = answers[`${command} ${args[0]} ${args[1] ?? ''}`.trim()] ?? {}
    return { exitCode: 0, stdout: '', stderr: '', timedOut: false, ...answer }
  }
}

describe('restack', () => {
  describe('rebasing', rebasingTests)
  describe('a dirty checkout', dirtyCheckoutTests)
  describe('not rebasing', notRebasingTests)
  describe('a refusal that is not a conflict', refusalTests)
})

function rebasingTests() {
  it('asks GitHub to rebase the lane branch, with an explicit timeout', async () => {
    const calls: Call[] = []
    await restack(lane, scripted({}, calls))

    expect(calls[0]).toEqual({
      command: 'gh',
      args: ['pr', 'update-branch', 'lane/1', '--rebase'],
      timeoutMs: 120_000,
    })
  })

  it('pulls the rebased branch into a clean checkout', async () => {
    const calls: Call[] = []
    const result = await restack(lane, scripted({}, calls))

    expect(result).toEqual({ kind: 'rebased', pushed: true })
    expect(calls.map((c) => c.args.slice(0, 2).join(' '))).toEqual([
      'pr update-branch',
      'status --porcelain',
      'pull --rebase',
    ])
    expect(calls[2]?.args).toEqual(['pull', '--rebase', 'origin', 'lane/1'])
  })
}

function notRebasingTests() {
  it('reports a conflict with no file list', async () => {
    const result = await restack(
      lane,
      scripted({ 'gh pr update-branch': { exitCode: 1, stderr: 'merge conflict' } })
    )

    expect(result).toEqual({
      kind: 'conflict',
      files: [],
      reason: 'GitHub could not rebase the branch: merge conflict',
    })
  })

  it('reports a timeout as a failure, not a conflict', async () => {
    const result = await restack(
      lane,
      scripted({ 'gh pr update-branch': { exitCode: 1, timedOut: true } })
    )

    expect(result).toEqual({
      kind: 'failed',
      reason: 'gh pr update-branch timed out after 120 seconds',
    })
  })
}

function refusalTests() {
  it('reports a refusal that is not a conflict as a failure, so it is tried again', async () => {
    const result = await restack(
      lane,
      scripted({ 'gh pr update-branch': { exitCode: 1, stderr: 'HTTP 401: Bad credentials' } })
    )

    expect(result).toEqual({
      kind: 'failed',
      reason: 'GitHub could not rebase the branch: HTTP 401: Bad credentials',
    })
  })
}

function dirtyCheckoutTests() {
  it('leaves a dirty checkout alone and says it is behind', async () => {
    const calls: Call[] = []
    const result = await restack(
      lane,
      scripted({ 'git status --porcelain': { stdout: ' M a.ts\n' } }, calls)
    )

    expect(result).toEqual({ kind: 'rebased', pushed: true, checkoutBehind: true })
    expect(calls.some((c) => c.args[0] === 'pull')).toBe(false)
  })
}
