import { z } from 'zod'
import { noPayload } from '@terminator/extension-sdk'
import { logger } from '../logger.js'
import { ipcInvokeRegistry, type IpcRegistryEntry } from '../remote/ipc-registry.js'
import { mcpToolSpecs, type McpToolSpec } from '../../../core-shared/src/electron-api/manifest.js'
import { toolMarks, type McpToolDef, type ToolProvider } from './tool-types.js'

// Every manifest method that opts in with `mcp` (ADR 145), called the way the remote bridge calls
// it. Built on each tools/list, so a channel registered after startup still appears.

const EMPTY_OBJECT_SCHEMA = { type: 'object', properties: {} }
const reportedMissing = new Set<string>()

/** The input schema MCP wants (an object), and how to turn its arguments into the payload. */
function inputFor(schema: z.ZodType | undefined): {
  inputSchema: Record<string, unknown>
  payloadOf: (args: Record<string, unknown>) => unknown
} {
  // The bridge sends `{}` for a method that takes nothing.
  if (schema === undefined || schema === noPayload) {
    return { inputSchema: EMPTY_OBJECT_SCHEMA, payloadOf: () => ({}) }
  }
  const json = z.toJSONSchema(schema, { unrepresentable: 'any' }) as Record<string, unknown>
  if (json.type === 'object') return { inputSchema: json, payloadOf: (args) => args }
  const { $schema, ...payload } = json
  return {
    inputSchema: { $schema, type: 'object', properties: { payload }, required: ['payload'] },
    payloadOf: (args) => args.payload,
  }
}

function manifestTool(spec: McpToolSpec, entry: IpcRegistryEntry): McpToolDef {
  const { inputSchema, payloadOf } = inputFor(entry.schema)
  return {
    name: spec.tool,
    description: spec.description,
    inputSchema,
    ...toolMarks(spec),
    call: async (args) => entry.handler(undefined as never, payloadOf(args)),
  }
}

export const manifestTools: ToolProvider = {
  tools: () =>
    mcpToolSpecs().flatMap((spec) => {
      const entry = ipcInvokeRegistry.get(spec.channel)
      if (entry) return [manifestTool(spec, entry)]
      if (!reportedMissing.has(spec.channel)) {
        reportedMissing.add(spec.channel)
        logger.warn('MCP tool has no registered channel', {
          tool: spec.tool,
          channel: spec.channel,
        })
      }
      return []
    }),
}
