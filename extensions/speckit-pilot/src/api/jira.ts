import type { JiraCreds, Ticket } from '../types/speckit.types.js'
import { withRetry, type RetryOptions } from '../utils/retry.js'

class JiraError extends Error {
  constructor(
    public readonly status: number,
    message: string
  ) {
    super(message)
  }
}

function makeAuthHeader(email: string, apiToken: string): string {
  return `Basic ${btoa(`${email}:${apiToken}`)}`
}

function baseUrl(domain: string): string {
  return `https://${domain}/rest/api/3`
}

interface JiraIssue {
  id: string
  key: string
  self: string
  fields: {
    summary: string
    status: { name: string }
  }
  renderedFields?: {
    description?: string | null
  }
}

export async function fetchAssignedTickets(
  creds: JiraCreds,
  retryOptions?: RetryOptions
): Promise<Ticket[]> {
  const { domain, email, apiToken, jql } = creds
  const url = `${baseUrl(domain)}/search?jql=${encodeURIComponent(jql)}&fields=summary,status,priority&expand=renderedFields`

  const issues = await withRetry(async () => {
    const res = await fetch(url, {
      headers: {
        Authorization: makeAuthHeader(email, apiToken),
        Accept: 'application/json',
      },
    })
    if (res.status === 429) throw new JiraError(429, 'Rate limited')
    if (!res.ok) throw new JiraError(res.status, `Jira request failed: ${res.status}`)
    const data = (await res.json()) as { issues: JiraIssue[] }
    return data.issues
  }, retryOptions)

  return issues.map((issue) => ({
    source: 'jira' as const,
    key: issue.key,
    title: issue.fields.summary,
    sourceUrl: `https://${domain}/browse/${issue.key}`,
    body: issue.renderedFields?.description ?? '',
    bodyFormat: 'html' as const,
    acceptanceCriteria: [],
  }))
}

export async function postComment(creds: JiraCreds, issueKey: string, text: string): Promise<void> {
  const { domain, email, apiToken } = creds
  const url = `${baseUrl(domain)}/issue/${issueKey}/comment`

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: makeAuthHeader(email, apiToken),
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify({
      body: {
        type: 'doc',
        version: 1,
        content: [{ type: 'paragraph', content: [{ type: 'text', text }] }],
      },
    }),
  })
  if (!res.ok) throw new JiraError(res.status, `postComment failed: ${res.status}`)
}

export async function transitionStatus(
  creds: JiraCreds,
  issueKey: string,
  transitionId: string
): Promise<void> {
  const { domain, email, apiToken } = creds
  const url = `${baseUrl(domain)}/issue/${issueKey}/transitions`

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: makeAuthHeader(email, apiToken),
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ transition: { id: transitionId } }),
  })
  if (!res.ok) throw new JiraError(res.status, `transitionStatus failed: ${res.status}`)
}
