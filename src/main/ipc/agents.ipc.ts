import { defineChannel, validationError, type ChannelSpec } from '@terminator/extension-sdk'
import { registerInvokeTable, noPayload } from './invoke-table.js'
import { agentService } from '../agents/acp/agent-service-instance.js'
import {
  AgentAnswerInputSchema,
  AgentPromptInputSchema,
  AgentSessionInputSchema,
  AgentSetConfigInputSchema,
  AgentStartInputSchema,
} from '../../shared/schemas/agents.schema.js'

// Core-only. The renderer's side of the agents over ACP; the pushes (`agents:update`,
// `agents:permission`, `agents:permission-settled`, `agents:end`) are broadcast by the service.

const agentChannels: ChannelSpec[] = [
  defineChannel({
    channel: 'agents:list',
    schema: noPayload,
    invalid: validationError,
    run: async () => ({ data: await agentService().list() }),
  }),
  defineChannel({
    channel: 'agents:start',
    schema: AgentStartInputSchema,
    invalid: validationError,
    run: async (input) => ({ data: await agentService().start(input) }),
  }),
  defineChannel({
    channel: 'agents:prompt',
    schema: AgentPromptInputSchema,
    invalid: validationError,
    run: async ({ sessionId, text }) => ({ data: await agentService().prompt(sessionId, text) }),
  }),
  defineChannel({
    channel: 'agents:cancel',
    schema: AgentSessionInputSchema,
    invalid: validationError,
    run: ({ sessionId }) => {
      agentService().cancel(sessionId)
      return { data: true }
    },
  }),
  defineChannel({
    channel: 'agents:answer',
    schema: AgentAnswerInputSchema,
    invalid: validationError,
    run: async ({ sessionId, requestId, optionId }) => ({
      data: await agentService().answer(sessionId, requestId, optionId),
    }),
  }),
  defineChannel({
    channel: 'agents:set-config',
    schema: AgentSetConfigInputSchema,
    invalid: validationError,
    run: async ({ sessionId, configId, value }) => ({
      data: await agentService().setConfig(sessionId, configId, value),
    }),
  }),
  defineChannel({
    channel: 'agents:close',
    schema: AgentSessionInputSchema,
    invalid: validationError,
    run: async ({ sessionId }) => {
      await agentService().close(sessionId)
      return { data: true }
    },
  }),
  defineChannel({
    channel: 'agents:history',
    schema: AgentSessionInputSchema,
    invalid: validationError,
    run: ({ sessionId }) => ({ data: agentService().readHistory(sessionId) }),
  }),
  defineChannel({
    channel: 'agents:open-asks',
    schema: noPayload,
    invalid: validationError,
    run: () => ({ data: agentService().openAsks() }),
  }),
]

export function registerAgentsHandlers(): void {
  registerInvokeTable(agentChannels)
}
