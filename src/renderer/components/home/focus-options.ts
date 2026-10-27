import type { HomeFocusCandidate, WorkKey } from '../../../shared/schemas/home-feed.schema'
import type { FocusItem } from '../../home/focus'
import type { WorkThread } from '../../home/work-threads'

/** What a thread points at: the ticket or the branch an extension named, when it has one.
 * @internal */
export function workKeyOfThread(thread: WorkThread): WorkKey | undefined {
  const [tracker, ticket] = thread.key.split(/:(.*)/s)
  if (thread.ticketKey && tracker === 'linear' && ticket) {
    return { tracker, key: ticket }
  }
  return thread.facets[0]?.workKey
}

export type FocusOption = Omit<FocusItem, 'doneByHand'>

export function optionOfThread(thread: WorkThread): FocusOption {
  const workKey = workKeyOfThread(thread)
  return {
    id: thread.key,
    title: thread.title,
    detail: thread.prChip?.text ?? (thread.nowLine || undefined),
    ...(workKey ? { workKey } : {}),
  }
}

export function optionOfCandidate(candidate: HomeFocusCandidate): FocusOption {
  return {
    id: candidate.id,
    title: candidate.title,
    detail: candidate.detail,
    ...(candidate.workKey ? { workKey: candidate.workKey } : {}),
  }
}
