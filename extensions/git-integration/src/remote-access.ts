/**
 * The channels the remote browser client's Git and review views may call
 * (ADR 094: extension channels are local-only unless declared). Each reads
 * status or pull request data. Left out on purpose: anything that writes to a
 * repository, GitHub or the stores (fetching a ref counts), runs the review
 * agent or a terminal, or returns a file's content or diff.
 */
export const REMOTE_READ_CHANNELS: ReadonlySet<string> = new Set([
  'git:conflicts-list',
  'git:pr-status',
  'git:status',
  'github:accessible-repos',
  'github:active-reviews-for-repo',
  'github:current-user',
  'github:dashboard-search',
  'github:list-open-prs',
  'github:pr-compare',
  'github:pr-inline-comments',
  'github:pr-issue-comments',
  'github:pr-review-detail',
  'github:review-settings',
  'github:session-get',
  'github:sessions-for-repo',
  'review-agent:list',
  'review-agent:settings',
])

export function remoteAccessFor(channel: string): { remoteAccessible: boolean } {
  return { remoteAccessible: REMOTE_READ_CHANNELS.has(channel) }
}
