import { createRequire } from 'node:module'
import type { AgentDescriptor } from '@terminator/extension-sdk'
import { envWithoutParentClaude } from '@terminator/extension-sdk/node'
import type { AgentsSettings } from '../../../shared/schemas/settings.schema.js'

export const CLAUDE_AGENT_ID = 'claude'

export interface AgentLaunch {
  command: string
  args: string[]
  env: Record<string, string>
}

const CLAUDE_LABEL = 'Claude Code'

export function listAgents(settings: AgentsSettings): AgentDescriptor[] {
  const custom = settings.custom.map(({ id, label }) => ({ id, label }))
  return [{ id: CLAUDE_AGENT_ID, label: CLAUDE_LABEL }, ...custom]
}

/** The built-in agent runs the Claude adapter on Electron's own Node; a custom one runs as set. */
export function resolveAgent(settings: AgentsSettings, agentId: string): AgentLaunch | null {
  const env = envWithoutParentClaude(process.env)
  if (agentId === CLAUDE_AGENT_ID) {
    const adapter = createRequire(import.meta.url)
      .resolve('@agentclientprotocol/claude-agent-acp/dist/index.js')
      // asarUnpack puts the adapter on disk, where a child process can read it.
      .replace('app.asar/', 'app.asar.unpacked/')
    return {
      command: process.execPath,
      args: [adapter],
      env: { ...env, ELECTRON_RUN_AS_NODE: '1' },
    }
  }
  const custom = settings.custom.find((agent) => agent.id === agentId)
  return custom ? { command: custom.command, args: custom.args, env } : null
}

const asRecord = (value: unknown): Record<string, unknown> =>
  typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : {}

/** `meta` with the user's own `claude` set for the adapter; an option the caller set stays. */
export function withClaudeExecutable(
  meta: Record<string, unknown> | undefined,
  executable: string
): Record<string, unknown> {
  const claudeCode = asRecord(meta?.claudeCode)
  const options = asRecord(claudeCode.options)
  return {
    ...meta,
    claudeCode: { ...claudeCode, options: { pathToClaudeCodeExecutable: executable, ...options } },
  }
}
