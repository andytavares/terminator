import { describe, it, expect } from 'vitest'
import { spawnSync } from 'node:child_process'
import { join } from 'node:path'
import { makeTempDir } from '../../support/temp-dir'

const SCRIPT = join(__dirname, '../../../scripts/check-temp-leaks.mjs')

// The script runs in a temporary directory of the spec's own, OUTER: a command
// that sets NODE_COMPILE_CACHE writes a cache there, which the spec removes.
function runLeakCheck(...command: string[]) {
  const { NODE_COMPILE_CACHE: _unset, ...inherited } = process.env
  const outer = makeTempDir('check-temp-leaks-spec-')
  const env = { ...inherited, TMPDIR: outer, OUTER: outer }
  return spawnSync(process.execPath, [SCRIPT, ...command], { encoding: 'utf8', env })
}

const nodeEval = (source: string) => [process.execPath, '-e', source]

describe('scripts/check-temp-leaks.mjs', () => {
  it('fails and names what a command left in its temporary directory', () => {
    const run = runLeakCheck(
      ...nodeEval(
        "const { mkdtempSync } = require('node:fs'); const { join } = require('node:path');" +
          "for (const i of [1, 2]) mkdtempSync(join(require('node:os').tmpdir(), 'leaky-'))"
      )
    )

    expect(run.status).toBe(1)
    expect(run.stderr).toContain('2 entries left')
    expect(run.stderr).toMatch(/2\s+leaky-\*/)
  })

  it('lists the files left, so the spec that wrote them can be found', () => {
    const run = runLeakCheck(
      ...nodeEval(
        "const fs = require('node:fs'); const dir = require('node:path').join(require('node:os').tmpdir(), 'orders', 'WO-1');" +
          "fs.mkdirSync(dir, { recursive: true }); fs.writeFileSync(dir + '/ledger.jsonl', '')"
      )
    )

    expect(run.status).toBe(1)
    expect(run.stderr).toContain(join('orders', 'WO-1', 'ledger.jsonl'))
  })
})

describe('scripts/check-temp-leaks.mjs — clean runs and failing commands', () => {
  it('passes when the command removes what it created', () => {
    const run = runLeakCheck(
      ...nodeEval(
        "const fs = require('node:fs'); const dir = fs.mkdtempSync(require('node:path').join(require('node:os').tmpdir(), 'tidy-'));" +
          'fs.rmSync(dir, { recursive: true, force: true })'
      )
    )

    expect(run.status).toBe(0)
    expect(run.stdout).toContain('0 entries left')
  })

  it('fails with the command’s own exit code when the command fails', () => {
    const run = runLeakCheck(...nodeEval('process.exit(3)'))

    expect(run.status).toBe(3)
  })

  it('leaves npm’s compile cache where it was, outside the checked directory', () => {
    const run = runLeakCheck(
      ...nodeEval(
        "const { join } = require('node:path'); if (process.env.NODE_COMPILE_CACHE !== join(process.env.OUTER, 'node-compile-cache')) process.exit(5)"
      )
    )

    expect(run.status).toBe(0)
  })
})

describe("scripts/check-temp-leaks.mjs — the command's directory", () => {
  it('points the command at an empty directory of its own', () => {
    const run = runLeakCheck(
      ...nodeEval(
        "const os = require('node:os'); if (require('node:fs').readdirSync(os.tmpdir()).length !== 0 || os.tmpdir() === process.env.OUTER) process.exit(4)"
      )
    )

    expect(run.status).toBe(0)
  })
})
