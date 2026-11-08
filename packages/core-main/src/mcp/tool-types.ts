import { z } from 'zod'

/** The relay's first line: which Claude Code session is calling, and from where. */
export const McpCallerSchema = z.object({
  sessionId: z.string().nullable(),
  claudePid: z.number().int().positive(),
  projectDir: z.string(),
})

export type McpCaller = z.infer<typeof McpCallerSchema>

interface McpToolAnnotations {
  readOnlyHint?: boolean
  destructiveHint?: boolean
}

/** One tool of the Terminator MCP server. `inputSchema` is a JSON Schema of type object. */
export interface McpToolDef {
  name: string
  description: string
  inputSchema: Record<string, unknown>
  annotations: McpToolAnnotations
  _meta?: Record<string, unknown>
  call(args: Record<string, unknown>, caller: McpCaller): Promise<unknown>
}

export interface ToolProvider {
  tools(): McpToolDef[]
}

/** A destructive tool makes Claude Code ask on every call, over allow rules and in every mode
 * (ADR 145, "Asking"). */
export function toolMarks(marks: {
  destructive: boolean
  readOnly: boolean
}): Pick<McpToolDef, 'annotations' | '_meta'> {
  if (marks.destructive) {
    return {
      annotations: { destructiveHint: true },
      _meta: { 'anthropic/requiresUserInteraction': true },
    }
  }
  if (marks.readOnly) return { annotations: { readOnlyHint: true, destructiveHint: false } }
  return { annotations: { destructiveHint: false } }
}
