import { describe, it, expect } from 'vitest'
import * as path from 'node:path'
import { spawnSync } from 'node:child_process'
import { installRelayScript } from '../../../src/mcp/relay-script'
import { makeTempDir } from '../../../../test-support/src/temp-dir'

describe('the relay', () => {
  it('exits 1 and says so when Terminator is not running', async () => {
    const dir = makeTempDir('mcp-relay-')
    const relayPath = await installRelayScript(dir)
    const run = spawnSync(process.execPath, [relayPath, path.join(dir, 'missing.sock')], {
      input: '',
      encoding: 'utf8',
    })
    expect(run.status).toBe(1)
    expect(run.stderr).toContain('Terminator is not running')
  })
})
