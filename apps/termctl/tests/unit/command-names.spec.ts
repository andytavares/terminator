import { describe, it, expect } from 'vitest'
import { commandName } from '../../src/command-names'
import appTools from '../fixtures/app-tools.json'

describe('commandName: the rule and the overrides', () => {
  it.each([
    ['list_tasks', 'task', 'list'],
    ['create_worktree', 'worktree', 'create'],
    ['get_agent_usage', 'agent-usage', 'get'],
    ['list_branches', 'branch', 'list'],
    ['list_my_issues', 'my-issue', 'list'],
    ['get_integration_status', 'integration-status', 'get'],
    ['update_project_branch', 'project-branch', 'update'],
  ])('maps %s by the rule: the verb first, the noun after it in singular', (tool, group, verb) => {
    expect(commandName(tool)).toEqual({ group, verb })
  })

  it.each([
    ['is_git_repo', 'git', 'is-repo'],
    ['current_branch', 'branch', 'current'],
    ['git_checkout', 'git', 'checkout'],
    ['git_fetch', 'git', 'fetch'],
    ['alert', 'alert', 'send'],
    ['agent_history', 'agent', 'history'],
    ['close_all_terminals', 'terminal', 'close-all'],
  ])('maps %s from the override table, which the rule gets wrong', (tool, group, verb) => {
    expect(commandName(tool)).toEqual({ group, verb })
  })
})

describe('commandName: raw names and uniqueness', () => {
  it('keeps the raw name of a one-word tool the table does not know', () => {
    expect(commandName('ping')).toEqual({ group: 'ping', verb: null })
  })

  it("gives each of the app's tools a command no other tool has", () => {
    const commands = appTools.map((tool) => {
      const { group, verb } = commandName(tool.name)
      return `${group} ${verb}`
    })
    expect(appTools).toHaveLength(108)
    expect(new Set(commands).size).toBe(108)
  })
})
