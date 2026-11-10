import { describe, it, expect } from 'vitest'
import { McpCallerSchema } from '../../../src/mcp/tool-types'

describe('McpCallerSchema', () => {
  it('accepts a hello from an older relay without a terminal id, as no terminal', () => {
    const hello = { sessionId: 's1', claudePid: 42, projectDir: '/Users/me/repos/shop' }
    expect(McpCallerSchema.parse(hello).terminalId).toBeNull()
  })
})
