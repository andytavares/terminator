import type { BrowserWindow } from 'electron'
import { defineChannel, validationError, type ChannelSpec } from '@terminator/extension-sdk'
import { registerInvokeTable, noPayload } from './invoke-table.js'
import { sendToWindow } from '../safe-send.js'
import { HomeFeedActionInputSchema } from '../../shared/schemas/home-feed.schema.js'
import { getMergedFeed, onFeedChange, runAction } from '../home/home-feed.js'

// Core-only. Extensions publish through api.home; they never read what Home shows.

const feedChannels: ChannelSpec[] = [
  defineChannel({
    channel: 'home:feed-get',
    schema: noPayload,
    invalid: validationError,
    run: () => ({ data: getMergedFeed() }),
  }),
  defineChannel({
    channel: 'home:feed-action',
    schema: HomeFeedActionInputSchema,
    invalid: validationError,
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
