import * as fs from 'node:fs/promises'
import * as path from 'node:path'
import type { UnattendedLaunch } from '../../shared/schemas/schedules.schema.js'

// A PreToolUse hook approves every call of a scheduled run; ask rules still prompt for destructive
// commands, because deny and ask rules win over a hook's allow
// (https://code.claude.com/docs/en/permissions#precedence-among-rules-hooks-and-mods).

const DESTRUCTIVE_ASKS = [
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

const ALLOW_OUTPUT = JSON.stringify({
  hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'allow' },
})

const SETTINGS = {
  permissions: { ask: DESTRUCTIVE_ASKS, deny: ['AskUserQuestion'] },
  hooks: {
    PreToolUse: [
      { matcher: '*', hooks: [{ type: 'command', command: `printf '%s' '${ALLOW_OUTPUT}'` }] },
    ],
  },
}

/** The folder the agent writes alerts into; `watchAlerts` reads it. */
export const alertsFolder = (folder: string): string => path.join(folder, 'alerts')

const systemPrompt = (alerts: string): string => `This is a scheduled run. Nobody is watching it.
Do not ask questions. Make the most reasonable choice and continue. Commands that destroy data still ask the person.

When the task asks you to alert the person, show something on Terminator's Home screen, or send a notification, write a JSON file with a new unique name ending in .json into this folder:
${alerts}

The file holds {"title": "<short title>", "message": "<one or two sentences>", "home": true, "notify": true}.
"home": true shows the alert on Home until the person dismisses it. "notify": true sends a notification.
`

/** Writes the settings and the prompt into `folder`, overwriting the copies of an earlier start. */
export async function writeUnattendedFiles(folder: string): Promise<UnattendedLaunch> {
  const launch = {
    settingsPath: path.join(folder, 'settings.json'),
    systemPromptPath: path.join(folder, 'system-prompt.md'),
    systemPrompt: systemPrompt(alertsFolder(folder)),
  }
  await fs.mkdir(alertsFolder(folder), { recursive: true })
  await fs.writeFile(launch.settingsPath, JSON.stringify(SETTINGS, null, 2), 'utf8')
  await fs.writeFile(launch.systemPromptPath, launch.systemPrompt, 'utf8')
  return launch
}
