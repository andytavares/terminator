import { describe, it, expect } from 'vitest'
import { toCommands, type ToolInfo } from '../../src/command-names'
import { commandHelp, groupHelp, rootHelp } from '../../src/help'
import appToolsJson from '../fixtures/app-tools.json'

// A JSON import types each schema by its literal shape; the app sends them as JSON Schema.
const commands = toCommands(appToolsJson as unknown as ToolInfo[])

describe('help', () => {
  it('lists each group with its verbs', () => {
    const help = rootHelp(commands)
    expect(help).toMatch(/^ {2}task +archive, create, delete, list, merge, update$/m)
    expect(help).toMatch(/^ {2}git +change-stats, checkout, fetch, is-repo$/m)
  })

  it('lists the global flags', () => {
    const help = rootHelp(commands)
    expect(help).toMatch(/^ {2}--json +/m)
    expect(help).toMatch(/^ {2}--yes +/m)
    expect(help).toMatch(/^ {2}--help +/m)
    expect(help).toMatch(/^ {2}--socket <path> +/m)
  })

  it("lists a group's verbs with their tools' descriptions", () => {
    const help = groupHelp('worktree', commands)
    expect(help).toContain('Usage: termctl worktree <verb> [flags]')
    expect(help).toMatch(/^ {2}list +Lists the worktrees/m)
  })

  it("shows a command's description and its flags, required ones marked", () => {
    const createWorktree = commands.find((command) => command.tool.name === 'create_worktree')!
    const help = commandHelp(createWorktree)
    expect(help).toContain('Usage: termctl worktree create [flags]')
    expect(help).toContain(createWorktree.tool.description)
    expect(help).toMatch(/^ {2}--repo-root <string> +required$/m)
    expect(help).toMatch(/^ {2}--is-new-branch +switch$/m)
  })
})
