import type { IncomingMessage } from 'node:http'
import type { StubAnswer } from './tracker-stub-jira'

// The stub Linear API (tracker-stub.ts): the GraphQL operations the Linear SDK
// sends for what the core reads and writes, answered by operation name. Each
// connection carries the fields the SDK's models read when they are built.
// Variables are checked against their declared GraphQL types, as Linear's
// server does (https://spec.graphql.org/October2021/#sec-Coercing-Variable-Values).

export interface LinearStubIssue {
  identifier: string
  title: string
  description: string
  state: { name: string; type: 'unstarted' | 'started' | 'completed' }
  assigneeEmail: string | null
  comments: Array<{ author: string; body: string; createdAt: string }>
}

export interface LinearState {
  apiKey: string
  viewer: { name: string; email: string }
  issues: LinearStubIssue[]
  /** Every operation the SDK sent, with its variables. */
  operations: Array<{ name: string; variables: Record<string, unknown> }>
}

const MODEL_DEFAULTS = { reactions: [], reactionData: {}, labelIds: [], previousIdentifiers: [] }
const PAGE = { pageInfo: { hasNextPage: false, hasPreviousPage: false } }

function issueNode(issue: LinearStubIssue) {
  return {
    ...MODEL_DEFAULTS,
    id: issue.identifier,
    identifier: issue.identifier,
    title: issue.title,
    description: issue.description,
    url: `https://linear.app/acme/issue/${issue.identifier}`,
    branchName: issue.identifier.toLowerCase(),
    updatedAt: '2026-10-01T09:00:00.000Z',
    createdAt: '2026-10-01T09:00:00.000Z',
    sharedAccess: {
      isShared: false,
      sharedWithCount: 0,
      sharedWithUsers: [],
      disallowedIssueFields: [],
    },
    syncedWith: [],
    state: { id: `state:${issue.identifier}` },
    assignee: issue.assigneeEmail ? { id: issue.assigneeEmail } : null,
    team: { id: 'team' },
  }
}

const connection = (issues: LinearStubIssue[]) => ({ nodes: issues.map(issueNode), ...PAGE })

function findIssue(state: LinearState, id: unknown): LinearStubIssue | undefined {
  return state.issues.find((i) => i.identifier === id)
}

function issueComments(state: LinearState, id: unknown) {
  const nodes = (findIssue(state, id)?.comments ?? []).map((c, index) => ({
    ...MODEL_DEFAULTS,
    id: `${String(id)}-comment-${index}`,
    body: c.body,
    createdAt: c.createdAt,
    updatedAt: c.createdAt,
    user: { id: c.author },
  }))
  return { issue: { comments: { nodes, ...PAGE } } }
}

function createComment(state: LinearState, input: { issueId: string; body: string }) {
  findIssue(state, input.issueId)?.comments.push({
    author: state.viewer.email,
    body: input.body,
    createdAt: new Date().toISOString(),
  })
  return { commentCreate: { success: true, lastSyncId: 1, comment: { id: 'new' } } }
}

type Operation = (state: LinearState, variables: Record<string, unknown>) => unknown

const OPERATIONS: Record<string, Operation> = {
  viewer: (state) => ({ viewer: { id: state.viewer.email, ...state.viewer } }),
  user_assignedIssues: (state, v) => ({
    user: { assignedIssues: connection(state.issues.filter((i) => i.assigneeEmail === v.id)) },
  }),
  issues: (state, v) => {
    const email = (v.filter as { assignee?: { email?: { eq?: string } } })?.assignee?.email?.eq
    return { issues: connection(state.issues.filter((i) => i.assigneeEmail === email)) }
  },
  searchIssues: (state, v) => {
    const term = String(v.term).toLowerCase()
    const found = state.issues.filter((i) => i.title.toLowerCase().includes(term))
    return { searchIssues: { ...connection(found), totalCount: found.length, archivePayload: {} } }
  },
  issue: (state, v) => ({
    issue: findIssue(state, v.id) ? issueNode(findIssue(state, v.id)!) : null,
  }),
  workflowState: (state, v) => {
    const issue = findIssue(state, String(v.id).replace('state:', ''))
    return { workflowState: { id: v.id, position: 0, ...issue?.state } }
  },
  user: (state, v) => ({
    user: {
      id: v.id,
      name: v.id === state.viewer.email ? state.viewer.name : String(v.id),
      email: v.id,
    },
  }),
  issue_labels: () => ({ issue: { labels: { nodes: [], ...PAGE } } }),
  issue_comments: (state, v) => issueComments(state, v.id),
  createComment: (state, v) => createComment(state, v.input as { issueId: string; body: string }),
}

/** A `$name: String!` variable given something other than a string, as GraphQL refuses it. */
function invalidStringVariable(query: string, variables: Record<string, unknown>): string | null {
  for (const [, name] of query.matchAll(/\$(\w+): String!/g)) {
    if (typeof variables[name] !== 'string') {
      return `Variable "$${name}" got invalid value ${JSON.stringify(variables[name])}; String cannot represent a non string value`
    }
  }
  return null
}

export function answerLinear(
  state: LinearState,
  request: IncomingMessage,
  body: unknown
): StubAnswer {
  if (request.headers.authorization !== state.apiKey) {
    return {
      status: 400,
      body: {
        errors: [
          {
            message: 'Authentication required, not authenticated',
            extensions: { type: 'authentication error', code: 'AUTHENTICATION_ERROR' },
          },
        ],
      },
    }
  }
  const { query, variables = {} } = body as { query: string; variables?: Record<string, unknown> }
  const name = query.match(/(?:query|mutation) (\w+)/)?.[1] ?? ''
  state.operations.push({ name, variables })
  const invalid = invalidStringVariable(query, variables)
  if (invalid)
    return {
      status: 400,
      body: { errors: [{ message: invalid, extensions: { code: 'GRAPHQL_VALIDATION_FAILED' } }] },
    }
  const operation = OPERATIONS[name]
  if (!operation)
    return { status: 400, body: { errors: [{ message: `stub Linear has no ${name}` }] } }
  return { status: 200, body: { data: operation(state, variables) } }
}
