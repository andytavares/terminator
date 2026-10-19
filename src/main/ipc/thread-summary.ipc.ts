import { defineChannel, type ChannelSpec } from '@terminator/extension-sdk'
import { registerInvokeTable } from './invoke-table.js'
import { createThreadSummarizer } from '../home/thread-summary.js'
import { runTextCommand } from '../shell/command-runner.js'
import { loginShellPathReady } from '../shell/login-shell-path.js'
import { ThreadSummaryInputSchema } from '../../shared/schemas/agent-usage.schema.js'

const summarize = createThreadSummarizer({
  run: runTextCommand,
  env: () => process.env,
  now: Date.now,
  ready: loginShellPathReady,
})

const summaryChannels: ChannelSpec[] = [
  defineChannel({
    channel: 'home:thread-summary',
    schema: ThreadSummaryInputSchema,
    invalid: () => ({ error: 'Could not write a summary: the work thread was not understood' }),
    run: (input) => summarize(input),
    onError: () => ({ error: 'Could not write a summary: something went wrong' }),
  }),
]

export function registerThreadSummaryHandler(): void {
  registerInvokeTable(summaryChannels)
}
