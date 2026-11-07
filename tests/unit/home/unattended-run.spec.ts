import { describe, it, expect, afterEach } from 'vitest'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { writeUnattendedFiles } from '../../../src/main/home/unattended-run'
import { mcpToolSpecs } from '../../../src/shared/electron-api/manifest'
import { RENDERER_TOOLS } from '../../../src/shared/mcp/renderer-tools'

const made: string[] = []
afterEach(() => made.splice(0).forEach((dir) => rmSync(dir, { recursive: true, force: true })))

function folder(): string {
  const dir = mkdtempSync(join(tmpdir(), 'unattended-'))
  made.push(dir)
  return dir
}

interface Settings {
  permissions: { ask: string[]; deny: string[]; defaultMode?: string }
  hooks?: unknown
}

async function written() {
  const dir = folder()
  const launch = await writeUnattendedFiles(dir, 'terminator')
  const settings = JSON.parse(readFileSync(launch.settingsPath, 'utf8')) as Settings
  return { dir, launch, settings, prompt: readFileSync(launch.systemPromptPath, 'utf8') }
}

describe('writeUnattendedFiles', () => {
  it('starts in auto mode: no routine prompts, a classifier blocks risky calls', async () => {
    const { settings } = await written()
    expect(settings.permissions.defaultMode).toBe('auto')
    expect(settings.hooks).toBeUndefined()
  })

  it('keeps ask rules for destructive commands, which auto mode still asks', async () => {
    const { settings } = await written()
    expect(settings.permissions.ask).toEqual(
      expect.arrayContaining([
        'Bash(rm -rf *)',
        'Bash(git reset --hard*)',
        'Bash(git push --force*)',
      ])
    )
  })
})

describe('writeUnattendedFiles, Terminator MCP tools', () => {
  it('keeps asking for every destructive Terminator MCP tool', async () => {
    const { settings } = await written()
    const manifest = mcpToolSpecs().filter((spec) => spec.destructive)
    const renderer = Object.entries(RENDERER_TOOLS).filter(([, tool]) => 'destructive' in tool)
    const tools = [...manifest.map((spec) => spec.tool), ...renderer.map(([name]) => name)]
    expect(manifest.length).toBeGreaterThan(0)
    expect(settings.permissions.ask).toEqual(
      expect.arrayContaining([...tools, 'install_update'].map((tool) => `mcp__terminator__${tool}`))
    )
  })
})

describe('writeUnattendedFiles, the prompt and the questions', () => {
  it('refuses clarifying questions, which nobody is there to answer', async () => {
    const { settings } = await written()
    expect(settings.permissions.deny).toEqual(['AskUserQuestion'])
  })

  it('tells the agent to alert through the Terminator MCP alert tool, not a folder', async () => {
    const { dir, prompt } = await written()
    expect(prompt).toContain('mcp__terminator__alert')
    expect(prompt).toContain('Scheduled run · ')
    expect(prompt).not.toContain(join(dir, 'alerts'))
    expect(existsSync(join(dir, 'alerts'))).toBe(false)
  })

  it('hands over the prompt text, for an agent that takes it as text', async () => {
    const { launch, prompt } = await written()
    expect(launch.systemPrompt).toBe(prompt)
  })

  it('writes the same files again on the next start', async () => {
    const dir = folder()
    const first = await writeUnattendedFiles(dir, 'terminator')
    expect(await writeUnattendedFiles(dir, 'terminator')).toEqual(first)
  })
})

describe('writeUnattendedFiles, under a dev build’s server name', () => {
  it('names the tools and the ask rules after the server it is given', async () => {
    const launch = await writeUnattendedFiles(folder(), 'terminator-dev')
    const settings = JSON.parse(readFileSync(launch.settingsPath, 'utf8')) as Settings
    expect(launch.systemPrompt).toContain('mcp__terminator-dev__alert')
    expect(settings.permissions.ask).toContain('mcp__terminator-dev__install_update')
    expect(settings.permissions.ask.join(' ')).not.toContain('mcp__terminator__')
  })
})
