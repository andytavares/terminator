import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { JiraCreds } from '../../src/types/speckit.types.js'

// Mock fetch globally
const mockFetch = vi.fn()
vi.stubGlobal('fetch', mockFetch)

const TEST_CREDS: JiraCreds = {
  domain: 'mycompany.atlassian.net',
  email: 'user@mycompany.com',
  apiToken: 'jira-test-token',
  jql: 'assignee = currentUser() AND status != Done',
}

function makeIssuesResponse(issues: unknown[] = []) {
  return {
    ok: true,
    status: 200,
    json: async () => ({ issues }),
  }
}

function makeIssue(overrides = {}) {
  return {
    id: '10001',
    key: 'PROJ-1',
    fields: {
      summary: 'Fix the login bug',
      status: { name: 'In Progress' },
      priority: { name: 'High' },
    },
    self: 'https://mycompany.atlassian.net/rest/api/3/issue/10001',
    ...overrides,
  }
}

async function loadJira() {
  return import('../../src/api/jira.js')
}

describe('fetchAssignedTickets', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
  })

  it('exports fetchAssignedTickets', async () => {
    mockFetch.mockResolvedValue(makeIssuesResponse([]))
    const mod = await loadJira()
    expect(typeof mod.fetchAssignedTickets).toBe('function')
  })

  it('sends correct JQL in the request URL', async () => {
    mockFetch.mockResolvedValue(makeIssuesResponse([]))
    const { fetchAssignedTickets } = await import('../../src/api/jira.js')
    await fetchAssignedTickets(TEST_CREDS)

    const calledUrl = mockFetch.mock.calls[0][0] as string
    expect(calledUrl).toContain('mycompany.atlassian.net')
    expect(calledUrl).toContain(encodeURIComponent('assignee = currentUser()'))
  })

  it('maps Jira issues to Ticket[] with source = "jira"', async () => {
    mockFetch.mockResolvedValue(makeIssuesResponse([makeIssue()]))
    const { fetchAssignedTickets } = await import('../../src/api/jira.js')
    const tickets = await fetchAssignedTickets(TEST_CREDS)

    expect(tickets).toHaveLength(1)
    expect(tickets[0].source).toBe('jira')
    expect(tickets[0].key).toBe('PROJ-1')
    expect(tickets[0].title).toBe('Fix the login bug')
  })

  it('includes the issue URL as sourceUrl', async () => {
    mockFetch.mockResolvedValue(makeIssuesResponse([makeIssue()]))
    const { fetchAssignedTickets } = await import('../../src/api/jira.js')
    const tickets = await fetchAssignedTickets(TEST_CREDS)

    expect(tickets[0].sourceUrl).toContain('PROJ-1')
  })

  it('uses Base64 Basic auth in Authorization header', async () => {
    mockFetch.mockResolvedValue(makeIssuesResponse([]))
    const { fetchAssignedTickets } = await import('../../src/api/jira.js')
    await fetchAssignedTickets(TEST_CREDS)

    const fetchOptions = mockFetch.mock.calls[0][1] as RequestInit
    const authHeader = (fetchOptions.headers as Record<string, string>)['Authorization']
    expect(authHeader).toMatch(/^Basic /)

    // Verify it encodes user:token correctly
    const decoded = atob(authHeader.replace('Basic ', ''))
    expect(decoded).toBe(`${TEST_CREDS.email}:${TEST_CREDS.apiToken}`)
  })

  it('throws on 401 without retrying', async () => {
    mockFetch.mockResolvedValue({ ok: false, status: 401, json: async () => ({}) })
    const { fetchAssignedTickets } = await import('../../src/api/jira.js')
    await expect(fetchAssignedTickets(TEST_CREDS)).rejects.toThrow()
    // Only called once — no retry on 401
    expect(mockFetch).toHaveBeenCalledTimes(1)
  })

  it('retries on 429 response', async () => {
    let callCount = 0
    mockFetch.mockImplementation(async () => {
      callCount++
      if (callCount === 1) {
        return { ok: false, status: 429, json: async () => ({}) }
      }
      return makeIssuesResponse([])
    })

    const { fetchAssignedTickets } = await import('../../src/api/jira.js')
    const tickets = await fetchAssignedTickets(TEST_CREDS, { maxAttempts: 2, baseDelayMs: 1 })
    expect(tickets).toEqual([])
    expect(mockFetch).toHaveBeenCalledTimes(2)
  })

  it('uses renderedFields.description as body when present', async () => {
    const issueWithDescription = makeIssue({
      renderedFields: { description: '<p>HTML description</p>' },
    })
    mockFetch.mockResolvedValue(makeIssuesResponse([issueWithDescription]))
    const { fetchAssignedTickets } = await import('../../src/api/jira.js')
    const tickets = await fetchAssignedTickets(TEST_CREDS)
    expect(tickets[0].body).toBe('<p>HTML description</p>')
    expect(tickets[0].bodyFormat).toBe('html')
  })

  it('falls back to empty string when renderedFields.description is null', async () => {
    const issueWithNullDesc = makeIssue({ renderedFields: { description: null } })
    mockFetch.mockResolvedValue(makeIssuesResponse([issueWithNullDesc]))
    const { fetchAssignedTickets } = await import('../../src/api/jira.js')
    const tickets = await fetchAssignedTickets(TEST_CREDS)
    expect(tickets[0].body).toBe('')
  })
})

describe('postComment', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
  })

  it('exports postComment', async () => {
    mockFetch.mockResolvedValue({ ok: true, status: 201, json: async () => ({}) })
    const mod = await loadJira()
    expect(typeof mod.postComment).toBe('function')
  })

  it('posts to the Jira comment endpoint for the given issue key', async () => {
    mockFetch.mockResolvedValue({ ok: true, status: 201, json: async () => ({}) })
    const { postComment } = await import('../../src/api/jira.js')
    await postComment(TEST_CREDS, 'PROJ-1', 'Tests are passing')

    const calledUrl = mockFetch.mock.calls[0][0] as string
    expect(calledUrl).toContain('PROJ-1')
    expect(calledUrl).toContain('comment')

    const body = JSON.parse((mockFetch.mock.calls[0][1] as RequestInit).body as string)
    expect(body).toMatchObject({ body: expect.anything() })
  })

  it('throws on non-ok response', async () => {
    mockFetch.mockResolvedValue({ ok: false, status: 403, json: async () => ({}) })
    const { postComment } = await import('../../src/api/jira.js')
    await expect(postComment(TEST_CREDS, 'PROJ-1', 'hello')).rejects.toThrow('403')
  })
})

describe('transitionStatus', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
  })

  it('exports transitionStatus', async () => {
    const mod = await loadJira()
    expect(typeof mod.transitionStatus).toBe('function')
  })

  it('posts to the transitions endpoint with the transition id', async () => {
    mockFetch.mockResolvedValue({ ok: true, status: 204 })
    const { transitionStatus } = await import('../../src/api/jira.js')
    await transitionStatus(TEST_CREDS, 'PROJ-1', '31')

    const calledUrl = mockFetch.mock.calls[0][0] as string
    expect(calledUrl).toContain('PROJ-1')
    expect(calledUrl).toContain('transitions')

    const body = JSON.parse((mockFetch.mock.calls[0][1] as RequestInit).body as string)
    expect(body).toEqual({ transition: { id: '31' } })
  })

  it('uses Basic auth in the Authorization header', async () => {
    mockFetch.mockResolvedValue({ ok: true, status: 204 })
    const { transitionStatus } = await import('../../src/api/jira.js')
    await transitionStatus(TEST_CREDS, 'PROJ-1', '31')

    const fetchOptions = mockFetch.mock.calls[0][1] as RequestInit
    const authHeader = (fetchOptions.headers as Record<string, string>)['Authorization']
    expect(authHeader).toMatch(/^Basic /)
    expect(atob(authHeader.replace('Basic ', ''))).toBe(
      `${TEST_CREDS.email}:${TEST_CREDS.apiToken}`
    )
  })

  it('throws on non-ok response', async () => {
    mockFetch.mockResolvedValue({ ok: false, status: 400 })
    const { transitionStatus } = await import('../../src/api/jira.js')
    await expect(transitionStatus(TEST_CREDS, 'PROJ-1', '99')).rejects.toThrow('400')
  })
})
