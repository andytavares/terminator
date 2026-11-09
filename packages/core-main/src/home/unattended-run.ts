import * as fs from 'node:fs/promises'
import * as path from 'node:path'
import type { UnattendedLaunch } from '../../../core-shared/src/schemas/schedules.schema.js'
import { mcpToolSpecs } from '../../../core-shared/src/electron-api/manifest.js'
import { RENDERER_TOOLS } from '../../../core-shared/src/mcp/renderer-tools.js'

// A scheduled run starts in auto mode: no routine prompts, and a classifier blocks risky calls.
// Explicit ask rules still prompt, so destructive commands keep asking
// (https://code.claude.com/docs/en/permission-modes#eliminate-prompts-with-auto-mode).

/** Destructive Terminator MCP tools under `server`, the name the server is registered as;
 * `install_update` lives in packages/core-main/src/mcp/app-tools.ts. */
const destructiveTerminatorTools = (server: string): string[] =>
  [
    ...mcpToolSpecs()
      .filter((spec) => spec.destructive)
      .map((spec) => spec.tool),
    ...Object.entries(RENDERER_TOOLS)
      .filter(([, tool]) => 'destructive' in tool)
      .map(([name]) => name),
    'install_update',
  ].map((tool) => `mcp__${server}__${tool}`)

const DESTRUCTIVE_COMMANDS = [
  'Bash(rm -rf *)',
  'Bash(rm -fr *)',
  'Bash(sudo *)',
  'Bash(git reset --hard*)',
  'Bash(git checkout -- *)',
  'Bash(git restore *)',
  'Bash(git clean *)',
  'Bash(git stash drop*)',
  'Bash(git branch -D *)',
  'Bash(git push --force*)',
  'Bash(git push -f*)',
]

const unattendedSettings = (server: string) => ({
  permissions: {
    defaultMode: 'auto',
    ask: [...DESTRUCTIVE_COMMANDS, ...destructiveTerminatorTools(server)],
    deny: ['AskUserQuestion'],
  },
})

const systemPromptFor = (
  server: string
): string => `This is a scheduled run. Nobody is watching it, and nobody reads this tab.
Do not ask questions. Make the most reasonable choice and continue. Commands that destroy data still ask the person.

Anything the person must see goes through the \`alert\` tool of the \`${server}\` MCP server (\`mcp__${server}__alert\`).
Call it once for each item that needs the person. Do not call it when nothing does.
Set \`source\` to "Scheduled run · " followed by the task in at most six words.
`

/** Writes the settings and the prompt into `folder`, overwriting the copies of an earlier start.
 * `server` is the name the Terminator MCP server is registered as in Claude Code. */
export async function writeUnattendedFiles(
  folder: string,
  server: string
): Promise<UnattendedLaunch> {
  const launch = {
    settingsPath: path.join(folder, 'settings.json'),
    systemPromptPath: path.join(folder, 'system-prompt.md'),
    systemPrompt: systemPromptFor(server),
  }
  await fs.mkdir(folder, { recursive: true })
  await fs.writeFile(
    launch.settingsPath,
    JSON.stringify(unattendedSettings(server), null, 2),
    'utf8'
  )
  await fs.writeFile(launch.systemPromptPath, launch.systemPrompt, 'utf8')
  return launch
}
