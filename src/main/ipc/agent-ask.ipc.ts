import type { BrowserWindow } from 'electron'
import { defineChannel, type ChannelSpec, validationError } from '@terminator/extension-sdk'
import { registerInvokeTable, noPayload } from './invoke-table.js'
import { sendToWindow } from '../safe-send.js'
import { currentAsks, onAskChange } from '../agents/ask-watcher.js'

// Core-only. Tells the window which terminals have an agent waiting on an answer.

const askChannels: ChannelSpec[] = [
  defineChannel({
    channel: 'agent-ask:list',
    schema: noPayload,
    invalid: validationError,
    run: () => ({ data: currentAsks() }),
  }),
]

export function registerAgentAskHandlers(getWindow: () => BrowserWindow | null): void {
  registerInvokeTable(askChannels)
  onAskChange((sessionId, ask) =>
    sendToWindow(getWindow(), 'agent-ask:changed', { sessionId, ask })
  )
}
