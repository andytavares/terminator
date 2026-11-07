import { describe, it, expect, afterEach } from 'vitest'
import { execSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { writeUnattendedFiles } from '../../../src/main/home/unattended-run'

const made: string[] = []
afterEach(() => made.splice(0).forEach((dir) => rmSync(dir, { recursive: true, force: true })))

function folder(): string {
  const dir = mkdtempSync(join(tmpdir(), 'unattended-'))
  made.push(dir)
  return dir
}

interface Settings {
  permissions: { ask: string[]; deny: string[] }
  hooks: { PreToolUse: Array<{ matcher: string; hooks: Array<{ command: string }> }> }
}

async function written() {
  const dir = folder()
  const launch = await writeUnattendedFiles(dir)
  const settings = JSON.parse(readFileSync(launch.settingsPath, 'utf8')) as Settings
  return { dir, launch, settings, prompt: readFileSync(launch.systemPromptPath, 'utf8') }
}

describe('writeUnattendedFiles', () => {
  it('approves every tool call through a PreToolUse hook that prints allow', async () => {
    const { settings } = await written()
    const [entry] = settings.hooks.PreToolUse
    expect(entry.matcher).toBe('*')
    const output = JSON.parse(execSync(entry.hooks[0].command, { encoding: 'utf8' }))
    expect(output).toEqual({
      hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'allow' },
    })
  })

  it('keeps ask rules for destructive commands, which win over the hook', async () => {
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

describe('writeUnattendedFiles, the prompt and the questions', () => {
  it('refuses clarifying questions, which nobody is there to answer', async () => {
    const { settings } = await written()
    expect(settings.permissions.deny).toEqual(['AskUserQuestion'])
  })

  it('tells the agent where to write a Home alert or a notification', async () => {
    const { dir, prompt } = await written()
    expect(prompt).toContain(join(dir, 'alerts'))
    expect(prompt).toContain('"home"')
    expect(prompt).toContain('"notify"')
  })

  it('hands over the prompt text, for an agent that takes it as text', async () => {
    const { launch, prompt } = await written()
    expect(launch.systemPrompt).toBe(prompt)
  })

  it('writes the same files again on the next start', async () => {
    const dir = folder()
    const first = await writeUnattendedFiles(dir)
    expect(await writeUnattendedFiles(dir)).toEqual(first)
  })
})
