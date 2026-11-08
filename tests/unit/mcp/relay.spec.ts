import { describe, it, expect } from 'vitest'
import * as path from 'node:path'
import { installRelayScript } from '../../../src/main/mcp/relay-script'
import { makeTempDir } from '../../support/temp-dir'

describe('the relay', () => {
  it('is written as mcp-relay.cjs in the directory it is given', async () => {
    const dir = makeTempDir('mcp-relay-')
    expect(await installRelayScript(dir)).toBe(path.join(dir, 'mcp-relay.cjs'))
  })
})
