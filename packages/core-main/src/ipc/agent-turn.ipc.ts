import type { BrowserWindow } from 'electron'
import { defineChannel, type ChannelSpec, validationError } from '@terminator/extension-sdk'
import { registerInvokeTable, noPayload } from './invoke-table.js'
import { sendToWindow } from '../safe-send.js'
import { currentTurns, onTurnChange } from '../agents/agent-turns.js'

// Core-only. Tells the window which terminals have an agent mid-turn, from Claude Code's own hooks.

const turnChannels: ChannelSpec[] = [
  defineChannel({
    channel: 'agent-turn:list',
    schema: noPayload,
    invalid: validationError,
    run: () => ({ data: currentTurns() }),
  }),
]

export function registerAgentTurnHandlers(getWindow: () => BrowserWindow | null): void {
  registerInvokeTable(turnChannels)
  onTurnChange((sessionId, inTurn) =>
    sendToWindow(getWindow(), 'agent-turn:changed', { sessionId, inTurn })
  )
}
