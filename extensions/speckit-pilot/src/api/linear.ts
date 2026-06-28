import { LinearClient } from '@linear/sdk'
import type { Ticket } from '../types/speckit.types.js'
import { withRetry, type RetryOptions } from '../utils/retry.js'

export async function fetchAssignedTickets(
  apiKey: string,
  retryOptions?: RetryOptions
): Promise<Ticket[]> {
  const client = new LinearClient({ apiKey })
  const viewer = await client.viewer
  const issues = await withRetry(() => viewer.assignedIssues(), retryOptions)
  return issues.nodes.map((issue) => ({
    source: 'linear' as const,
    key: issue.identifier,
    title: issue.title,
    sourceUrl: issue.url,
    body: issue.description ?? '',
    bodyFormat: 'markdown' as const,
    acceptanceCriteria: [],
  }))
}

export async function postComment(apiKey: string, issueId: string, body: string): Promise<void> {
  const client = new LinearClient({ apiKey })
  await client.createComment({ issueId, body })
}
