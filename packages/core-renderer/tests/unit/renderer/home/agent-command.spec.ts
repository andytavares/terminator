// @vitest-environment node
import { describe, it, expect } from 'vitest'
import { agentCommand } from '../../../../src/terminal/start-session'

describe('agentCommand run by sh, without a prompt and with flags', () => {
  it('refuses a prompt whose line would pass the terminal limit', () => {
    expect(agentCommand('x'.repeat(2000))).toBeNull()
  })
})
