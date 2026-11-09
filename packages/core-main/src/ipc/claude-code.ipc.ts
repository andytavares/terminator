import { defineChannel, validationError, type ChannelSpec } from '@terminator/extension-sdk'
import { failureOf, noPayload, registerInvokeTable } from './invoke-table.js'
import {
  connect,
  disconnect,
  registrationStatus,
  type RegistrationOptions,
} from '../mcp/registration.js'

// Core-only. Settings › Integrations shows and changes the Terminator MCP server's entry in
// Claude Code (ADR 145). The options resolve once the relay script is installed.

/** A channel that runs `action` on the options and answers `true`. */
function changeChannel(
  channel: string,
  action: (options: RegistrationOptions) => Promise<void>,
  options: Promise<RegistrationOptions>
): ChannelSpec {
  return defineChannel({
    channel,
    schema: noPayload,
    invalid: validationError,
    run: async () => {
      await action(await options)
      return { data: true }
    },
    onError: failureOf,
  })
}

function claudeCodeChannels(options: Promise<RegistrationOptions>): ChannelSpec[] {
  return [
    defineChannel({
      channel: 'claude-code:status',
      schema: noPayload,
      invalid: validationError,
      run: async () => ({ data: await registrationStatus(await options) }),
      onError: failureOf,
    }),
    changeChannel('claude-code:connect', connect, options),
    changeChannel('claude-code:disconnect', disconnect, options),
  ]
}

export function registerClaudeCodeHandlers(options: Promise<RegistrationOptions>): void {
  registerInvokeTable(claudeCodeChannels(options))
}
