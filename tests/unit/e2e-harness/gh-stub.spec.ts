import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { chmodSync, writeFileSync } from 'node:fs'
import { delimiter, dirname, join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { makeTempDir } from '../../support/temp-dir'

// With no stub GitHub running, fixtures/bin/gh answers nothing. It never hands a call to a
// real gh further along PATH: that made Home pull the developer's own pull requests (ADR 123).

const STUB_DIR = resolve(__dirname, '../../e2e/fixtures/bin')
const STUB_TIMEOUT_MS = 3000

function fakeRealGh(): string {
  const dir = makeTempDir('real-gh-')
  writeFileSync(join(dir, 'gh'), '#!/bin/sh\necho "real gh $*"\n')
  chmodSync(join(dir, 'gh'), 0o755)
  return dir
}

interface StubRun {
  stdout: string
  stderr: string
  status: number | null
}

/** Runs the stub with `path` as PATH, in a process group of its own so a stub that
 * keeps running is killed whole when the deadline passes. */
async function runStub(path: string[], args: string[]): Promise<StubRun> {
  const env = {
    PATH: [...path, dirname(process.execPath)].join(delimiter),
    XDG_CONFIG_HOME: makeTempDir('gh-config-'),
  }
  const stub = spawn(process.execPath, [join(STUB_DIR, 'gh'), ...args], { env, detached: true })
  const run: StubRun = { stdout: '', stderr: '', status: null }
  stub.stdout.on('data', (chunk: Buffer) => (run.stdout += chunk.toString()))
  stub.stderr.on('data', (chunk: Buffer) => (run.stderr += chunk.toString()))
  try {
    await once(stub, 'exit', { signal: AbortSignal.timeout(STUB_TIMEOUT_MS) })
  } catch {
    process.kill(-(stub.pid ?? 0), 'SIGKILL')
    throw new Error(`the gh stub was still running after ${STUB_TIMEOUT_MS} ms`)
  }
  run.status = stub.exitCode
  return run
}

describe('the gh stub without a stub GitHub', () => {
  it('exits 1 and says no stub answers the call, even with a real gh on PATH', async () => {
    const run = await runStub([STUB_DIR, fakeRealGh()], ['pr', 'list'])
    expect(run).toEqual({ stdout: '', stderr: 'no stub answers gh pr list\n', status: 1 })
  })
})
