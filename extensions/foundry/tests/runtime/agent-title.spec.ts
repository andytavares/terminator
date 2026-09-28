import { describe, it, expect } from 'vitest'
import { agentTitle } from '../../src/runtime/agent-title.js'

describe('agentTitle', () => {
  it('names a role the way a person says it', () => {
    expect(agentTitle('red-team')).toBe('Red team')
    expect(agentTitle('architect')).toBe('Architect')
  })

  it('names a recipe step the same way', () => {
    expect(agentTitle('lint')).toBe('Lint')
    expect(agentTitle('integration_tests')).toBe('Integration tests')
  })
})
