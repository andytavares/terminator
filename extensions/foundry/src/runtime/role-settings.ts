import { denyRules } from './deny-rules.js'
import { modeFor } from './permission-mode.js'
import type { ModeFacts } from './permission-mode.js'

// A role's permissions as Claude Code settings (https://code.claude.com/docs/en/permissions):
// Claude reads every subcommand, subshell and control-flow body, so Foundry reads none.
// Precedence is deny, then ask, then allow; `dontAsk` turns every ask into a refusal.

export type ClaudePermissionMode = 'auto' | 'default' | 'acceptEdits' | 'dontAsk'

export interface RoleFacts extends ModeFacts {
  readonly outputPath: string | null
  readonly outputsDir: string | null
  readonly skillsMount: string | null
  readonly mayUseTool: (tool: string) => boolean
  /** The project's proven commands. */
  readonly probedCommands: readonly string[]
  /** Tools the operator has declared read-only. */
  readonly readOnlyTools: readonly string[]
}

export interface ClaudeSettings {
  permissions: { allow: string[]; ask: string[]; deny: string[] }
  sandbox?: { enabled: boolean; network: { allowedDomains: string[] } }
}

export interface RoleSettings {
  permissionMode: ClaudePermissionMode
  settings: ClaudeSettings
}

const DESTRUCTIVE_ASKS = [
  'Bash(rm -rf *)',
  'Bash(sudo *)',
  'Bash(git reset --hard*)',
  'Bash(git checkout -- *)',
  'Bash(git restore *)',
  'Bash(git clean *)',
  'Bash(git stash drop*)',
]

const READ_ONLY_ALLOWS = [
  'Read',
  'Grep',
  'Glob',
  'Bash(git log*)',
  'Bash(git show*)',
  'Bash(git diff*)',
  'Bash(git status*)',
  'Bash(git blame*)',
  'Bash(gh pr view*)',
  'Bash(gh pr diff*)',
  'Bash(gh pr checks*)',
  'Bash(gh issue view*)',
]

/** The paths `isDocumentationRelative` (verify/documentation-path.ts) accepts, as globs. */
const DOCUMENTATION_GLOBS = [
  '**/*.md',
  '**/*.MD',
  '**/README*',
  '**/Readme*',
  '**/readme*',
  '**/CHANGELOG*',
  '**/Changelog*',
  '**/changelog*',
  'docs/**',
  'specs/**',
]

const FILE_WRITE_TOOLS = ['Edit', 'MultiEdit', 'Write', 'NotebookEdit']

const SANDBOX_DOMAINS = ['github.com', 'api.github.com', '*.githubusercontent.com']

const isFreeWriter = (facts: ModeFacts): boolean =>
  !facts.readOnly && !facts.docsOnly && !facts.restrictedWrites

/** `//` starts an absolute path in a rule. */
const absolute = (target: string): string => `/${target}`

const writeRules = (target: string): string[] => [`Write(${target})`, `Edit(${target})`]

function modeOf(facts: RoleFacts): ClaudePermissionMode {
  // A role that publishes a document needs its Artifact ask to reach Foundry, which dontAsk refuses.
  if (!isFreeWriter(facts)) return facts.outputsDir === null ? 'dontAsk' : 'default'
  const mode = modeFor(facts)
  return mode === 'default' && facts.autonomy !== 'escorted' ? 'acceptEdits' : mode
}

function probedAllows(facts: RoleFacts): string[] {
  if (!isFreeWriter(facts) && !facts.mayUseTool('run_tests')) return []
  return facts.probedCommands.flatMap((command) => [`Bash(${command})`, `Bash(${command} *)`])
}

function declaredWrites(facts: RoleFacts): string[] {
  return [
    ...(facts.docsOnly ? DOCUMENTATION_GLOBS.flatMap(writeRules) : []),
    ...(facts.outputPath === null ? [] : writeRules(absolute(facts.outputPath))),
    ...(facts.outputsDir === null ? [] : writeRules(`${absolute(facts.outputsDir)}/**`)),
  ]
}

// `denyRules` drops Write and Edit from a role without the `edit` class, and with them its
// output file; such a role keeps both, and its allow rules name the only paths it may write.
function denyOf(facts: RoleFacts): string[] {
  const keepsWriteTools = declaredWrites(facts).length > 0
  return denyRules(facts).filter((rule) => !(keepsWriteTools && FILE_WRITE_TOOLS.includes(rule)))
}

function allowRules(facts: RoleFacts): string[] {
  if (isFreeWriter(facts)) return probedAllows(facts)
  return [
    ...READ_ONLY_ALLOWS,
    ...['WebFetch', 'WebSearch'].filter(facts.mayUseTool),
    ...declaredWrites(facts),
    ...probedAllows(facts),
    ...facts.readOnlyTools,
  ]
}

export function roleSettings(facts: RoleFacts): RoleSettings {
  return {
    permissionMode: modeOf(facts),
    settings: {
      permissions: {
        allow: allowRules(facts),
        ask: [...DESTRUCTIVE_ASKS, 'Artifact'],
        deny: [...denyOf(facts), 'Bash(git -C * push*)'],
      },
      // Free writers run Electron end-to-end checks, which the macOS sandbox can block.
      ...(isFreeWriter(facts)
        ? {}
        : { sandbox: { enabled: true, network: { allowedDomains: SANDBOX_DOMAINS } } }),
    },
  }
}
