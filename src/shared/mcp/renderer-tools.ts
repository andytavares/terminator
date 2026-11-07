import { z } from 'zod'

// Terminator MCP server tools that only the renderer can run: screen actions, Start work and
// quick actions. Main pushes an McpCall over `mcp:call`; the renderer answers over `mcp:answer`
// with the same id. A plain tool refuses destructive targets and names its destructive twin.

const ExtensionCommandInput = z.object({
  command: z.string().min(1),
  args: z.record(z.string(), z.unknown()).optional(),
})

export const RENDERER_TOOLS = {
  start_work: {
    description: 'Starts work on a prompt in Terminator, as Start work on Home does.',
    input: z.object({
      prompt: z.string().min(1),
      workspace: z.string().min(1).optional().describe('Workspace name or id'),
      runAs: z.enum(['agent', 'claude-terminal']).optional(),
      branch: z.string().min(1).optional(),
    }),
  },
  open_session: {
    description: 'Shows a Terminator session in the main window.',
    input: z.object({ sessionId: z.string().min(1) }),
  },
  open_terminal: {
    description: 'Opens a terminal tab in a folder, and can run a command in it.',
    input: z.object({
      cwd: z.string().min(1),
      command: z.string().min(1).optional(),
      workspace: z.string().min(1).optional().describe('Workspace name or id'),
    }),
  },
  open_in_window: {
    description: 'Moves a Terminator session into its own window.',
    input: z.object({ sessionId: z.string().min(1) }),
  },
  list_quick_actions: {
    description: 'Lists the quick actions that the Cmd+P panel shows.',
    input: z.object({}),
    readOnly: true,
  },
  run_quick_action: {
    description: 'Runs a quick action that does not close or delete anything.',
    input: z.object({ id: z.string().min(1) }),
  },
  run_destructive_quick_action: {
    description: 'Runs a quick action that closes or deletes something.',
    input: z.object({ id: z.string().min(1) }),
    destructive: true,
  },
  run_extension_command: {
    description: 'Runs an extension command that does not close or delete anything.',
    input: ExtensionCommandInput,
  },
  run_destructive_extension_command: {
    description: 'Runs an extension command that closes or deletes something.',
    input: ExtensionCommandInput,
    destructive: true,
  },
} as const satisfies Record<
  string,
  { description: string; input: z.ZodObject; destructive?: true; readOnly?: true }
>

export type RendererToolName = keyof typeof RENDERER_TOOLS

/** One renderer tool call that main pushes over `mcp:call`. */
export interface McpCall {
  id: string
  tool: RendererToolName
  args: unknown
}

/** The renderer's answer to the McpCall with the same id. */
export type McpAnswer = { id: string; result: unknown } | { id: string; error: string }
