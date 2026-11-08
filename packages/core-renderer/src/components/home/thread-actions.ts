import { SEND_TO_AGENT_ACTION } from '@terminator/extension-sdk/plain'
import { useHomeFeedStore } from '../../stores/home-feed.store'
import { startAgentInBranch } from '../../terminal/start-session'
import { runFeedAction } from './desk-actions'
import { useTaskStore } from '../../stores/task.store'
import { useParkedThreads } from './parked-threads'
import { workKeyId, type WorkThread } from '../../home/work-threads'
import type { SessionFacts } from '../../sidebar/session-facts'

/** The open session to show first: the one that most recently did something. */
export function leadSessionOf(thread: WorkThread): SessionFacts | undefined {
  return thread.sessions
    .filter((s) => !s.isClosed)
    .sort((a, b) => b.lastActivityAt - a.lastActivityAt)[0]
}

/** Archives or restores a thread: a stored task through the task store, other work by hand. */
export function toggleArchived(thread: WorkThread): void {
  if (thread.taskId !== null) {
    void useTaskStore.getState().archive(thread.taskId, !thread.archived)
    return
  }
  const parked = useParkedThreads.getState()
  if (thread.archived) parked.unpark(thread.key)
  else parked.park(thread.key)
}

export function openLinkExternally(url: string): void {
  void window.electronAPI?.shell?.openExternal(url)
}

/** Starts the default agent as a tab in the thread's branch, telling it the ticket when there is one. */
export async function startAgentOnBranch(thread: WorkThread): Promise<void> {
  const projectId = leadSessionOf(thread)?.projectId
  if (!projectId) return
  const prompt = thread.ticketKey ? `Work on ${thread.ticketKey}: ${thread.title}` : null
  await startAgentInBranch({ projectId, title: thread.ticketKey ?? 'Agent', prompt })
}

/** Runs the extension's own "send to agent" for this thread, when one published it; null when none did. */
export function useSendToAgent(thread: WorkThread): (() => Promise<boolean>) | null {
  const asks = useHomeFeedStore((s) => s.asks)
  const ids = [thread.key, ...thread.facets.map((f) => workKeyId(f.workKey))]
  const ask = asks.find(
    (a) =>
      a.workKey !== null &&
      ids.includes(workKeyId(a.workKey)) &&
      a.actions.some((action) => action.id === SEND_TO_AGENT_ACTION)
  )
  return ask ? () => runFeedAction(ask.source, ask.id, SEND_TO_AGENT_ACTION) : null
}
