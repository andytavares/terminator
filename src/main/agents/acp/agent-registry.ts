import { accessSync, constants } from 'node:fs'
import { createRequire } from 'node:module'
import { delimiter, join } from 'node:path'
import type { AgentDescriptor } from '@terminator/extension-sdk'
import { envWithoutParentClaude } from '@terminator/extension-sdk/node'
import type { KnownAgentStatus } from '../../../shared/schemas/agents.schema.js'
import type { AgentsSettings } from '../../../shared/schemas/settings.schema.js'
import { loginShellPathReady } from '../../shell/login-shell-path.js'

export const CLAUDE_AGENT_ID = 'claude'

export interface AgentLaunch {
  command: string
  args: string[]
  env: Record<string, string>
}

const CLAUDE_LABEL = 'Claude Code'

/** The built-in agent first, unless a custom agent named `claude` replaces it. */
export function listAgents(settings: AgentsSettings): AgentDescriptor[] {
  const custom = settings.custom.map(({ id, label }) => ({ id, label }))
  const replaced = custom.some((agent) => agent.id === CLAUDE_AGENT_ID)
  return replaced ? custom : [{ id: CLAUDE_AGENT_ID, label: CLAUDE_LABEL }, ...custom]
}

/** A custom agent runs as set; the built-in one runs the Claude adapter on Electron's own Node,
 * with the user's `claude` when one was found. */
export function resolveAgent(
  settings: AgentsSettings,
  agentId: string,
  claudeExecutable: string | null = null
): AgentLaunch | null {
  const env = envWithoutParentClaude(process.env)
  const custom = settings.custom.find((agent) => agent.id === agentId)
  if (custom) return { command: custom.command, args: custom.args, env }
  if (agentId === CLAUDE_AGENT_ID) {
    const adapter = createRequire(import.meta.url)
      .resolve('@agentclientprotocol/claude-agent-acp/dist/index.js')
      // asarUnpack puts the adapter on disk, where a child process can read it.
      .replace('app.asar/', 'app.asar.unpacked/')
    // The adapter reads its binary only from this variable; a session option is overwritten.
    const executable: Record<string, string> = claudeExecutable
      ? { CLAUDE_CODE_EXECUTABLE: claudeExecutable }
      : {}
    return {
      command: process.execPath,
      args: [adapter],
      env: { ...env, ...executable, ELECTRON_RUN_AS_NODE: '1' },
    }
  }
  return null
}

/** The first executable called `binary` on PATH, or null. */
export function binaryOnPath(binary: string): string | null {
  for (const directory of (process.env.PATH ?? '').split(delimiter)) {
    const candidate = join(directory, binary)
    try {
      accessSync(candidate, constants.X_OK)
      return candidate
    } catch {
      // Not in this directory.
    }
  }
  return null
}

/** Agents the settings offer to add. Each launch command is from the agent's own documentation.
 * `binary` is what must be on PATH; for an `npx` preset that is `npx`. */
export const KNOWN_AGENTS = [
  {
    // https://github.com/agentclientprotocol/codex-acp (the adapter Zed runs for Codex)
    id: 'codex',
    label: 'Codex',
    command: 'npx',
    args: ['-y', '@agentclientprotocol/codex-acp'],
    binary: 'npx',
  },
  {
    // https://geminicli.com/docs/cli/acp-mode/
    id: 'gemini',
    label: 'Gemini CLI',
    command: 'gemini',
    args: ['--acp'],
    binary: 'gemini',
  },
  {
    // https://opencode.ai/docs/acp/
    id: 'opencode',
    label: 'OpenCode',
    command: 'opencode',
    args: ['acp'],
    binary: 'opencode',
  },
  {
    // https://cursor.com/docs/cli/acp
    id: 'cursor',
    label: 'Cursor',
    command: 'agent',
    args: ['acp'],
    binary: 'agent',
  },
]

/** Each preset with whether its binary is on the login-shell PATH. */
export async function knownAgentStatuses(
  isOnPath: (binary: string) => boolean = (binary) => binaryOnPath(binary) !== null
): Promise<KnownAgentStatus[]> {
  await loginShellPathReady()
  return KNOWN_AGENTS.map(({ binary, ...agent }) => ({ ...agent, installed: isOnPath(binary) }))
}
