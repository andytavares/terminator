import { describe, it, expect } from 'vitest'
import { mcpSocketPath } from '../../../../core-shared/src/mcp/socket-path'

const tmp = '/var/folders/xy/T'

describe('mcpSocketPath', () => {
  it('puts the socket in the profile folder when the path fits a Unix socket', () => {
    const userData = '/Users/someone/Library/Application Support/@andytavares/terminator'
    expect(mcpSocketPath(userData, tmp)).toBe(`${userData}/mcp.sock`)
  })

  it('moves it to the temp folder when the profile path is too long, one name per profile', () => {
    const long = `/private/tmp/${'x'.repeat(100)}/ud`
    const path = mcpSocketPath(long, tmp)
    expect(path.startsWith(`${tmp}/terminator-mcp-`)).toBe(true)
    expect(Buffer.byteLength(path)).toBeLessThan(104)
    expect(mcpSocketPath(long, tmp)).toBe(path)
    expect(mcpSocketPath(`${long}2`, tmp)).not.toBe(path)
  })
})
