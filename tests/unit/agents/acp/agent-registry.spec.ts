import { describe, it, expect } from 'vitest'
import { listAgents, resolveAgent } from '../../../../src/main/agents/acp/agent-registry'

const settings = {
  default: 'claude',
  custom: [{ id: 'gemini', label: 'Gemini', command: 'gemini', args: ['--acp'] }],
}

describe('agent registry', () => {
  it('lists the built-in agent first, then the custom ones', () => {
    expect(listAgents(settings)).toEqual([
      { id: 'claude', label: 'Claude Code' },
      { id: 'gemini', label: 'Gemini' },
    ])
  })

  it('runs the Claude adapter on Electron as Node, without the parent Claude session', () => {
    process.env.CLAUDE_CODE_SESSION_ID = 'parent'
    const launch = resolveAgent(settings, 'claude')
    delete process.env.CLAUDE_CODE_SESSION_ID
    expect(launch?.command).toBe(process.execPath)
    expect(launch?.args[0]).toMatch(/claude-agent-acp\/dist\/index\.js$/)
    expect(launch?.env.ELECTRON_RUN_AS_NODE).toBe('1')
    expect(launch?.env.CLAUDE_CODE_SESSION_ID).toBeUndefined()
  })

  it('resolves a custom agent to its command and arguments', () => {
    expect(resolveAgent(settings, 'gemini')).toMatchObject({ command: 'gemini', args: ['--acp'] })
  })

  it('lets a custom agent named claude replace the built-in one', () => {
    const own = { id: 'claude', label: 'My Claude', command: 'my-acp', args: ['--x'] }
    const replaced = { default: 'claude', custom: [own] }
    expect(listAgents(replaced)).toEqual([{ id: 'claude', label: 'My Claude' }])
    expect(resolveAgent(replaced, 'claude')).toMatchObject({ command: 'my-acp', args: ['--x'] })
  })

  it('resolves an unknown id to nothing', () => {
    expect(resolveAgent(settings, 'nope')).toBeNull()
  })
})

describe('the Claude executable', () => {
  // The adapter reads only this variable; an option in the session meta is overwritten.
  it('reaches the built-in agent as CLAUDE_CODE_EXECUTABLE', () => {
    const launch = resolveAgent(settings, 'claude', '/Users/me/.local/bin/claude')
    expect(launch?.env.CLAUDE_CODE_EXECUTABLE).toBe('/Users/me/.local/bin/claude')
  })

  it('is left out when none is found, and never given to a custom agent', () => {
    expect(resolveAgent(settings, 'claude', null)?.env.CLAUDE_CODE_EXECUTABLE).toBeUndefined()
    const gemini = resolveAgent(settings, 'gemini', '/Users/me/.local/bin/claude')
    expect(gemini?.env.CLAUDE_CODE_EXECUTABLE).toBeUndefined()
  })
})
