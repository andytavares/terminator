import { describe, it, expect } from 'vitest'
import { socketLocation } from '../../src/socket-location'

const home = '/Users/someone'
const tmpDir = '/var/folders/xy/T'

describe('socketLocation', () => {
  it('uses the --socket flag before the environment', () => {
    const env = { TERMINATOR_MCP_SOCKET: '/env/mcp.sock' }
    expect(socketLocation({ flag: '/flag/mcp.sock', env, home, tmpDir })).toBe('/flag/mcp.sock')
  })

  it('uses TERMINATOR_MCP_SOCKET when there is no flag', () => {
    const env = { TERMINATOR_MCP_SOCKET: '/env/mcp.sock' }
    expect(socketLocation({ flag: null, env, home, tmpDir })).toBe('/env/mcp.sock')
  })

  it("falls back to the packaged app's profile folder", () => {
    expect(socketLocation({ flag: null, env: {}, home, tmpDir })).toBe(
      '/Users/someone/Library/Application Support/@andytavares/terminator/mcp.sock'
    )
  })
})
