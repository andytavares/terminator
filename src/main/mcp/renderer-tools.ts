import { randomUUID } from 'node:crypto'
import { once } from 'node:events'
import { z } from 'zod'
import type { BrowserWindow } from 'electron'
import { defineChannel, validationError } from '@terminator/extension-sdk'
import { registerInvokeTable } from '../ipc/invoke-table.js'
import { sendToWindow } from '../safe-send.js'
import {
  RENDERER_TOOLS,
  type McpCall,
  type RendererToolName,
} from '../../shared/mcp/renderer-tools.js'
import { toolMarks, type McpToolDef, type ToolProvider } from './tool-types.js'

// Tools only the renderer can run (ADR 145): main pushes an McpCall over `mcp:call` and settles
// it when `mcp:answer` brings the same id back.

const ANSWER_TIMEOUT_MS = 60_000

// The error branch comes first: the result branch would also accept `{ id, error }`.
const McpAnswerSchema = z.union([
  z.object({ id: z.string(), error: z.string() }),
  z.object({ id: z.string(), result: z.unknown() }),
])

interface PendingCall {
  resolve: (result: unknown) => void
  reject: (error: Error) => void
  timer: NodeJS.Timeout
}

const pending = new Map<string, PendingCall>()
let showWindow: () => BrowserWindow = () => {
  throw new Error('Terminator has not started its window yet')
}

function answerPendingCall(answer: z.infer<typeof McpAnswerSchema>): void {
  const call = pending.get(answer.id)
  if (!call) return
  pending.delete(answer.id)
  clearTimeout(call.timer)
  if ('error' in answer) call.reject(new Error(answer.error))
  else call.resolve(answer.result)
}

/** Registers `mcp:answer`; `showWindow` returns the main window, created and shown if it was closed. */
export function registerRendererTools(deps: { showWindow: () => BrowserWindow }): void {
  showWindow = deps.showWindow
  registerInvokeTable([
    defineChannel({
      channel: 'mcp:answer',
      schema: McpAnswerSchema,
      invalid: validationError,
      run: (answer) => answerPendingCall(answer),
    }),
  ])
}

function awaitAnswer(id: string): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      pending.delete(id)
      reject(new Error('Terminator did not answer in time'))
    }, ANSWER_TIMEOUT_MS)
    timer.unref()
    pending.set(id, { resolve, reject, timer })
  })
}

/** Runs a renderer tool in the main window and resolves with the renderer's answer. */
export async function callRendererTool(tool: RendererToolName, args: unknown): Promise<unknown> {
  const parsed = RENDERER_TOOLS[tool].input.safeParse(args)
  if (!parsed.success) {
    throw new Error(`${tool} cannot use these arguments: ${z.prettifyError(parsed.error)}`)
  }
  const window = showWindow()
  if (window.webContents.isLoading()) await once(window.webContents, 'did-finish-load')
  const call: McpCall = { id: randomUUID(), tool, args: parsed.data }
  const answer = awaitAnswer(call.id)
  sendToWindow(window, 'mcp:call', call)
  return answer
}

function rendererTool(name: RendererToolName): McpToolDef {
  const spec = RENDERER_TOOLS[name]
  return {
    name,
    description: spec.description,
    inputSchema: z.toJSONSchema(spec.input, { unrepresentable: 'any' }) as Record<string, unknown>,
    ...toolMarks({
      destructive: 'destructive' in spec && spec.destructive,
      readOnly: 'readOnly' in spec && spec.readOnly,
    }),
    call: (args) => callRendererTool(name, args),
  }
}

export const rendererTools: ToolProvider = {
  tools: () => (Object.keys(RENDERER_TOOLS) as RendererToolName[]).map(rendererTool),
}
