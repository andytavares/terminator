/* v8 ignore file */
import type { RunMode, FileChange } from '../types/foundry.types.js'

export interface RunRequest {
  mode: RunMode
  providerId: string
  model: string
  prompt: string
  workspaceRoot: string
  agentsMdContent: string
  iterationLimit: number
  conversationHistory?: Array<{ role: 'user' | 'agent'; content: string }>
  feedbackNote?: string
}

export type RunEvent =
  | { type: 'token'; token: string }
  | { type: 'file-changed'; filePath: string; change: FileChange }
  | { type: 'done'; tokenCountIn: number; tokenCountOut: number }
  | { type: 'error'; message: string }

export interface ProviderAdapter {
  readonly supportsStreaming: boolean
  run(request: RunRequest): AsyncIterable<RunEvent>
  testConnection(): Promise<{ ok: boolean; latencyMs: number }>
}
