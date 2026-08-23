import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createJiraProvider } from '../../../../src/main/integrations/providers/jira.provider'
import { TrackerError } from '../../../../src/main/integrations/tracker-error'
import {
  COMMENTS,
  CREDENTIAL,
  ISSUE_DONE,
  ISSUE_TAV_7,
  MYSELF,
  SEARCH_PAGE_1,
  SEARCH_PAGE_2,
} from '../../../fixtures/integrations/jira/index'

const provider = createJiraProvider()

/** The jql parameter as Jira receives it. URLSearchParams form-encodes spaces as '+'. */
function jqlOf(url: unknown): string {
  return new URL(String(url)).searchParams.get('jql') ?? ''
}

/** Route by URL so a test states which endpoints it expects to be hit. */
function routeFetch(routes: Array<[RegExp, unknown, number?]>): ReturnType<typeof vi.fn> {
  const calls = vi.fn(async (input: string | URL) => {
    const url = String(input)
    for (const [pattern, body, status] of routes) {
      if (pattern.test(url)) {
        return {
          ok: (status ?? 200) < 400,
          status: status ?? 200,
          headers: new Headers(),
          json: async () => body,
          text: async () => JSON.stringify(body),
        } as unknown as Response
      }
    }
    throw new Error(`unexpected fetch: ${url}`)
  })
  vi.stubGlobal('fetch', calls)
  return calls as unknown as ReturnType<typeof vi.fn>
}

beforeEach(() => vi.unstubAllGlobals())
afterEach(() => vi.unstubAllGlobals())

describe('jira provider — verify', () => {
  it('returns the account and site the credential belongs to', async () => {
    routeFetch([[/\/rest\/api\/3\/myself/, MYSELF]])
    await expect(provider.verify(CREDENTIAL)).resolves.toEqual({
      name: 'Andrew',
      email: 'andrew.tavares87@gmail.com',
      site: 'tav.atlassian.net',
    })
  })

  it('sends Basic auth built from the email and token', async () => {
    const fetchMock = routeFetch([[/\/myself/, MYSELF]])
    await provider.verify(CREDENTIAL)
    const init = fetchMock.mock.calls[0][1] as RequestInit
    const auth = (init.headers as Record<string, string>).Authorization
    expect(auth).toBe(
      `Basic ${Buffer.from('andrew.tavares87@gmail.com:token-abc').toString('base64')}`
    )
  })

  it('raises auth-failed on 401', async () => {
    routeFetch([[/\/myself/, { errorMessages: ['Unauthorized'] }, 401]])
    await expect(provider.verify(CREDENTIAL)).rejects.toMatchObject({ kind: 'auth-failed' })
  })
})

describe('jira provider — listMine', () => {
  it('uses /search/jql, not the deprecated /search (research R4)', async () => {
    const fetchMock = routeFetch([[/\/search\/jql/, { issues: [ISSUE_TAV_7], isLast: true }]])
    await provider.listMine(CREDENTIAL, { kind: 'query', jql: 'assignee = currentUser()' }, 25)

    const url = String(fetchMock.mock.calls[0][0])
    expect(url).toContain('/rest/api/3/search/jql')
    expect(url).not.toMatch(/\/rest\/api\/3\/search\?/)
    expect(jqlOf(url)).toBe('assignee = currentUser()')
  })

  it('follows nextPageToken until the last page', async () => {
    let call = 0
    const fetchMock = vi.fn(async () => {
      call += 1
      const body = call === 1 ? SEARCH_PAGE_1 : SEARCH_PAGE_2
      return {
        ok: true,
        status: 200,
        headers: new Headers(),
        json: async () => body,
      } as unknown as Response
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = await provider.listMine(CREDENTIAL, { kind: 'query', jql: 'x = y' }, 50)

    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(String(fetchMock.mock.calls[1][0])).toContain('nextPageToken=token-page-2')
    expect(result.map((i) => i.key)).toEqual(['TAV-7', 'TAV-8'])
  })

  it('stops at the requested limit even when more pages exist', async () => {
    const fetchMock = vi.fn(
      async () =>
        ({
          ok: true,
          status: 200,
          headers: new Headers(),
          json: async () => SEARCH_PAGE_1,
        }) as unknown as Response
    )
    vi.stubGlobal('fetch', fetchMock)
    const result = await provider.listMine(CREDENTIAL, { kind: 'query', jql: 'x = y' }, 1)
    expect(result).toHaveLength(1)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('reports a null branch name on summaries — Jira has no equivalent', async () => {
    routeFetch([[/\/search\/jql/, { issues: [ISSUE_TAV_7], isLast: true }]])
    const [issue] = await provider.listMine(CREDENTIAL, { kind: 'query', jql: 'x = y' }, 25)
    expect(issue.branchName).toBeNull()
  })

  it('normalises the status category into a state type', async () => {
    routeFetch([[/\/search\/jql/, { issues: [ISSUE_TAV_7, ISSUE_DONE], isLast: true }]])
    const result = await provider.listMine(CREDENTIAL, { kind: 'query', jql: 'x = y' }, 25)
    expect(result[0].state).toEqual({ name: 'In Progress', type: 'started' })
    expect(result[1].state).toEqual({ name: 'Done', type: 'completed' })
  })

  it('surfaces 429 as rate-limited carrying Retry-After', async () => {
    const fetchMock = vi.fn(
      async () =>
        ({
          ok: false,
          status: 429,
          headers: new Headers({ 'Retry-After': '30' }),
          json: async () => ({ errorMessages: ['Rate limited'] }),
        }) as unknown as Response
    )
    vi.stubGlobal('fetch', fetchMock)
    await expect(
      provider.listMine(CREDENTIAL, { kind: 'query', jql: 'x = y' }, 25)
    ).rejects.toMatchObject({ kind: 'rate-limited', retryAfterMs: 30_000 })
  })
})

describe('jira provider — search', () => {
  it('ANDs a text clause onto the configured query', async () => {
    const fetchMock = routeFetch([[/\/search\/jql/, { issues: [], isLast: true }]])
    await provider.search(CREDENTIAL, 'sidebar', 10)
    expect(jqlOf(fetchMock.mock.calls[0][0])).toContain('text ~ "sidebar"')
  })

  it('escapes quotes in the search term rather than breaking the query', async () => {
    const fetchMock = routeFetch([[/\/search\/jql/, { issues: [], isLast: true }]])
    await provider.search(CREDENTIAL, 'say "hello"', 10)
    expect(jqlOf(fetchMock.mock.calls[0][0])).toContain('text ~ "say \\"hello\\""')
  })
})

describe('jira provider — get', () => {
  it('converts the ADF description to markdown', async () => {
    routeFetch([
      [/\/issue\/TAV-7\/comment/, COMMENTS],
      [/\/issue\/TAV-7/, ISSUE_TAV_7],
    ])
    const issue = await provider.get(CREDENTIAL, 'TAV-7')

    expect(issue?.description).toContain('## Summary')
    expect(issue?.description).toContain('**three places**')
    expect(issue?.description).toContain('- one service')
    expect(issue?.description).toContain('```ts')
    // The point of the conversion: no ADF JSON reaches the renderer.
    expect(issue?.description).not.toContain('"type"')
  })

  it('converts ADF comment bodies to markdown too', async () => {
    routeFetch([
      [/\/issue\/TAV-7\/comment/, COMMENTS],
      [/\/issue\/TAV-7/, ISSUE_TAV_7],
    ])
    const issue = await provider.get(CREDENTIAL, 'TAV-7')
    expect(issue?.comments[0]).toEqual({
      author: 'Andrew',
      body: 'Verified against v3.',
      createdAt: '2026-08-22T10:15:00.000+0000',
    })
  })

  it('always reports branchName as null — Jira has no equivalent', async () => {
    routeFetch([
      [/\/issue\/TAV-7\/comment/, COMMENTS],
      [/\/issue\/TAV-7/, ISSUE_TAV_7],
    ])
    await expect(provider.get(CREDENTIAL, 'TAV-7')).resolves.toMatchObject({ branchName: null })
  })

  it('handles a null description without producing "null"', async () => {
    routeFetch([
      [/\/comment/, { comments: [] }],
      [/\/issue\/TAV-8/, ISSUE_DONE],
    ])
    const issue = await provider.get(CREDENTIAL, 'TAV-8')
    expect(issue?.description).toBe('')
    expect(issue?.completed).toBe(true)
    expect(issue?.assignee).toBeNull()
  })

  it('returns null on 404 rather than throwing', async () => {
    routeFetch([[/\/issue\//, { errorMessages: ['Issue does not exist'] }, 404]])
    await expect(provider.get(CREDENTIAL, 'TAV-999')).resolves.toBeNull()
  })
})

describe('jira provider — comment', () => {
  it('posts an ADF body to the issue key path', async () => {
    const fetchMock = routeFetch([[/\/issue\/TAV-7\/comment/, { id: '1' }, 201]])
    await provider.comment(CREDENTIAL, 'TAV-7', 'PR opened')

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toContain('/rest/api/3/issue/TAV-7/comment')
    expect(init.method).toBe('POST')
    expect(JSON.parse(String(init.body))).toEqual({
      body: {
        type: 'doc',
        version: 1,
        content: [{ type: 'paragraph', content: [{ type: 'text', text: 'PR opened' }] }],
      },
    })
  })

  it('rejects when the tracker refuses — never swallows (FR-034a)', async () => {
    routeFetch([[/\/comment/, { errorMessages: ['no permission'] }, 403]])
    await expect(provider.comment(CREDENTIAL, 'TAV-7', 'hi')).rejects.toMatchObject({
      kind: 'auth-failed',
    })
  })
})

describe('jira provider — credential guard', () => {
  it('refuses a credential belonging to another tracker', async () => {
    await expect(provider.verify({ tracker: 'linear', apiKey: 'k' })).rejects.toBeInstanceOf(
      TrackerError
    )
  })
})

describe('jira provider — hostile and incomplete responses', () => {
  it('survives an issue with no fields at all', async () => {
    routeFetch([
      [/\/comment/, { comments: [] }],
      [/\/issue\//, { id: '1', key: 'TAV-1' }],
    ])
    await expect(provider.get(CREDENTIAL, 'TAV-1')).resolves.toMatchObject({
      title: '',
      description: '',
      labels: [],
      state: { name: 'Unknown', type: 'backlog' },
      assignee: null,
    })
  })

  it('falls back to backlog for a status category Jira adds later', async () => {
    routeFetch([
      [/\/comment/, { comments: [] }],
      [
        /\/issue\//,
        {
          id: '1',
          key: 'TAV-1',
          fields: { status: { name: 'Odd', statusCategory: { key: 'zzz' } } },
        },
      ],
    ])
    await expect(provider.get(CREDENTIAL, 'TAV-1')).resolves.toMatchObject({
      state: { name: 'Odd', type: 'backlog' },
    })
  })

  it('still returns the issue when the comment request fails', async () => {
    const fetchMock = vi.fn(async (input: string | URL) => {
      if (String(input).includes('/comment')) throw new Error('comment endpoint down')
      return {
        ok: true,
        status: 200,
        headers: new Headers(),
        json: async () => ISSUE_TAV_7,
      } as unknown as Response
    })
    vi.stubGlobal('fetch', fetchMock)
    await expect(provider.get(CREDENTIAL, 'TAV-7')).resolves.toMatchObject({ comments: [] })
  })

  it('names an author Jira did not supply', async () => {
    routeFetch([
      [/\/comment/, { comments: [{ created: '2026-01-01', body: 'x' }] }],
      [/\/issue\//, ISSUE_TAV_7],
    ])
    const issue = await provider.get(CREDENTIAL, 'TAV-7')
    expect(issue?.comments[0]).toMatchObject({ author: 'Unknown' })
  })

  it('returns an empty list when a search page has no issues', async () => {
    routeFetch([[/\/search\/jql/, {}]])
    await expect(
      provider.listMine(CREDENTIAL, { kind: 'query', jql: 'x = y' }, 25)
    ).resolves.toEqual([])
  })

  it('stops paging when a page returns no token and does not claim to be last', async () => {
    const fetchMock = vi.fn(
      async () =>
        ({
          ok: true,
          status: 200,
          headers: new Headers(),
          json: async () => ({ issues: [ISSUE_TAV_7] }),
        }) as unknown as Response
    )
    vi.stubGlobal('fetch', fetchMock)
    await provider.listMine(CREDENTIAL, { kind: 'query', jql: 'x = y' }, 50)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('uses a sensible default query when handed an assignee selector', async () => {
    // A Linear-shaped selector cannot happen through the UI, but the type
    // permits it and silently returning nothing would be the worst answer.
    const fetchMock = routeFetch([[/\/search\/jql/, { issues: [], isLast: true }]])
    await provider.listMine(CREDENTIAL, { kind: 'assignee', email: null }, 10)
    expect(jqlOf(fetchMock.mock.calls[0][0])).toContain('currentUser()')
  })

  it('maps a dead network to unavailable, not to a bad credential', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw Object.assign(new TypeError('fetch failed'), { code: 'ENOTFOUND' })
      })
    )
    await expect(provider.verify(CREDENTIAL)).rejects.toMatchObject({ kind: 'unavailable' })
  })

  it('reports the field errors Jira returns for a bad JQL', async () => {
    routeFetch([[/\/search\/jql/, { errors: { jql: "unknown field 'foo'" } }, 400]])
    await expect(
      provider.listMine(CREDENTIAL, { kind: 'query', jql: 'foo = bar' }, 10)
    ).rejects.toMatchObject({ kind: 'failed', message: "jql: unknown field 'foo'" })
  })

  it('falls back to a generic message when Jira explains nothing', async () => {
    routeFetch([[/\/search\/jql/, {}, 500]])
    await expect(
      provider.listMine(CREDENTIAL, { kind: 'query', jql: 'x = y' }, 10)
    ).rejects.toMatchObject({ kind: 'unavailable', message: 'Jira request failed' })
  })

  it('falls back to the configured email when /myself omits one', async () => {
    routeFetch([[/\/myself/, { displayName: 'Andrew' }]])
    await expect(provider.verify(CREDENTIAL)).resolves.toMatchObject({
      email: 'andrew.tavares87@gmail.com',
    })
  })

  it('rejects a credential belonging to another tracker on every operation', async () => {
    const other = { tracker: 'linear' as const, apiKey: 'k' }
    await expect(provider.listMine(other, { kind: 'query', jql: 'x' }, 5)).rejects.toBeInstanceOf(
      TrackerError
    )
    await expect(provider.search(other, 'x', 5)).rejects.toBeInstanceOf(TrackerError)
    await expect(provider.get(other, 'TAV-1')).rejects.toBeInstanceOf(TrackerError)
    await expect(provider.comment(other, 'TAV-1', 'x')).rejects.toBeInstanceOf(TrackerError)
  })
})
