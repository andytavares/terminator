import { defineChannel, type ChannelSpec } from '@terminator/extension-sdk'
import { registerInvokeTable } from './invoke-table.js'
import { createThreadSummarizer } from '../home/thread-summary.js'
import { agentService } from '../agents/acp/agent-service-instance.js'
import { loginShellPathReady } from '../shell/login-shell-path.js'
import { listRecords } from '../sessions/session-record-store.js'
import { readTranscriptUsage } from '../agents/transcript-usage.js'
import {
  ThreadSummaryInputSchema,
  type ThreadSummaryInput,
} from '../../shared/schemas/agent-usage.schema.js'

const summarize = createThreadSummarizer({
  runOnce: (input) => agentService().runOnce(input),
  now: Date.now,
  ready: loginShellPathReady,
})

type SummarySession = ThreadSummaryInput['sessions'][number]

/** The session with its opening prompt and last words read from its transcript, when it has one. */
async function withTranscript(session: SummarySession): Promise<SummarySession> {
  const record = listRecords().find((r) => r.sessionId === session.sessionId)
  if (session.sessionId === undefined || !record?.agent) return session
  try {
    const { firstUserPrompt, lastAssistantTexts } = await readTranscriptUsage(
      record.agent.transcriptPath
    )
    return { ...session, firstUserPrompt, lastAssistantTexts }
  } catch {
    return session
  }
}

const summaryChannels: ChannelSpec[] = [
  defineChannel({
    channel: 'home:thread-summary',
    schema: ThreadSummaryInputSchema,
    invalid: () => ({ error: 'Could not write a summary: the work thread was not understood' }),
    run: async (input) =>
      summarize({ ...input, sessions: await Promise.all(input.sessions.map(withTranscript)) }),
    onError: () => ({ error: 'Could not write a summary: something went wrong' }),
  }),
]

export function registerThreadSummaryHandler(): void {
  registerInvokeTable(summaryChannels)
}
