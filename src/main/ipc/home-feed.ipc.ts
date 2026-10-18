import type { BrowserWindow } from 'electron'
import { defineChannel, type ChannelSpec } from '@terminator/extension-sdk'
import { registerInvokeTable, noPayload } from './invoke-table.js'
import { sendToWindow } from '../safe-send.js'
import { HomeFeedActionInputSchema } from '../../shared/schemas/home-feed.schema.js'
import { getMergedFeed, onFeedChange, runAction } from '../home/home-feed.js'

function invalid(error: { message: string }): { error: string; message: string } {
  return { error: 'VALIDATION_ERROR', message: error.message }
}

// Core-only. Extensions publish through api.home; they never read what Home shows.

const feedChannels: ChannelSpec[] = [
  defineChannel({
    channel: 'home:feed-get',
    schema: noPayload,
    invalid,
    run: () => ({ data: getMergedFeed() }),
  }),
  defineChannel({
    channel: 'home:feed-action',
    schema: HomeFeedActionInputSchema,
    invalid,
    run: async ({ source, itemId, actionId }) => {
      await runAction(source, itemId, actionId)
      return { data: true }
    },
    onError: (error) => ({
      error: 'failed',
      message: error instanceof Error ? error.message : String(error),
    }),
  }),
]

export function registerHomeFeedHandlers(getWindow: () => BrowserWindow | null): void {
  registerInvokeTable(feedChannels)
  onFeedChange((merged) => sendToWindow(getWindow(), 'home:feed-changed', merged))
}
