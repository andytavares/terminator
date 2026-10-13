import type { IncomingMessage } from 'node:http'

// The stub Jira Cloud (tracker-stub.ts): the four REST v3 endpoints the core
// reads, https://developer.atlassian.com/cloud/jira/platform/rest/v3/.
// Descriptions and comments are Atlassian Document Format, as Jira stores them.

interface JiraStubIssue {
  key: string
  summary: string
  status: { name: string; category: 'new' | 'indeterminate' | 'done' }
  description: string
  comments: Array<{ author: string; body: string; created: string }>
}

export interface JiraState {
  account: { displayName: string; emailAddress: string }
  /** The Basic credential every request must carry, "email:token". */
  credential: string
  issues: JiraStubIssue[]
  /** Every JQL the core searched with, in order. */
  searches: string[]
}

export interface StubAnswer {
  status: number
  body: unknown
}

const adf = (text: string) => ({
  type: 'doc',
  version: 1,
  content: [{ type: 'paragraph', content: [{ type: 'text', text }] }],
})

/** The text of a one-paragraph ADF document, which is all the core posts. */
function adfText(doc: unknown): string {
  const paragraph = (doc as { content?: Array<{ content?: Array<{ text?: string }> }> })
    ?.content?.[0]
  return (paragraph?.content ?? []).map((node) => node.text ?? '').join('')
}

function issueJson(issue: JiraStubIssue) {
  return {
    id: issue.key,
    key: issue.key,
    fields: {
      summary: issue.summary,
      description: adf(issue.description),
      status: { name: issue.status.name, statusCategory: { key: issue.status.category } },
      assignee: null,
      labels: [],
      updated: '2026-10-01T09:00:00.000+0000',
      resolutiondate: null,
    },
  }
}

function search(state: JiraState, url: URL): StubAnswer {
  const jql = url.searchParams.get('jql') ?? ''
  state.searches.push(jql)
  const text = jql.match(/text ~ "([^"]*)"/)?.[1]?.toLowerCase()
  const issues = state.issues.filter(
    (issue) => text === undefined || issue.summary.toLowerCase().includes(text)
  )
  return { status: 200, body: { issues: issues.map(issueJson), isLast: true } }
}

/** What a route reads of a request: its method, URL and JSON body. */
interface StubRequest {
  method: string | undefined
  url: URL
  body: unknown
}

function issueRoute(state: JiraState, { method, url, body }: StubRequest): StubAnswer {
  const [, key, sub] = url.pathname.match(/\/issue\/([^/]+)(\/comment)?$/) ?? []
  const issue = state.issues.find((i) => i.key === decodeURIComponent(key ?? ''))
  if (!issue) return { status: 404, body: { errorMessages: ['Issue does not exist'] } }
  if (!sub) return { status: 200, body: issueJson(issue) }
  if (method === 'POST') {
    const comment = {
      author: state.account.displayName,
      body: adfText((body as { body: unknown }).body),
      created: new Date().toISOString(),
    }
    issue.comments.push(comment)
    return { status: 201, body: { id: String(issue.comments.length) } }
  }
  const comments = issue.comments.map((c) => ({
    author: { displayName: c.author },
    body: adf(c.body),
    created: c.created,
  }))
  return { status: 200, body: { comments } }
}

export function answerJira(state: JiraState, request: IncomingMessage, body: unknown): StubAnswer {
  const expected = `Basic ${Buffer.from(state.credential).toString('base64')}`
  if (request.headers.authorization !== expected) {
    return { status: 401, body: { errorMessages: ['Client must be authenticated'] } }
  }
  const url = new URL(request.url ?? '/', 'https://stub')
  if (url.pathname === '/rest/api/3/myself') return { status: 200, body: state.account }
  if (url.pathname === '/rest/api/3/search/jql') return search(state, url)
  if (url.pathname.startsWith('/rest/api/3/issue/'))
    return issueRoute(state, { method: request.method, url, body })
  return { status: 404, body: { errorMessages: [`stub Jira has no ${url.pathname}`] } }
}
