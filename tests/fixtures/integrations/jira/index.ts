// Jira Cloud REST v3 response fixtures.
//
// Two things these exist to pin down: `/rest/api/3/search/jql` pages by
// `nextPageToken` (not startAt — the old `/search` is being removed), and
// descriptions and comments come back as ADF, not markdown.

export const MYSELF = {
  accountId: 'acct-1',
  displayName: 'Andrew',
  emailAddress: 'andrew.tavares87@gmail.com',
}

/** An ADF description exercising the node types FR-014 names. */
export const ADF_DESCRIPTION = {
  type: 'doc',
  version: 1,
  content: [
    { type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: 'Summary' }] },
    {
      type: 'paragraph',
      content: [
        { type: 'text', text: 'Reached from ' },
        { type: 'text', text: 'three places', marks: [{ type: 'strong' }] },
        { type: 'text', text: ' today.' },
      ],
    },
    {
      type: 'bulletList',
      content: [
        {
          type: 'listItem',
          content: [{ type: 'paragraph', content: [{ type: 'text', text: 'one service' }] }],
        },
      ],
    },
    {
      type: 'codeBlock',
      attrs: { language: 'ts' },
      content: [{ type: 'text', text: 'const a = 1' }],
    },
  ],
}

export const ISSUE_TAV_7 = {
  id: '10007',
  key: 'TAV-7',
  fields: {
    summary: 'Move Jira behind the shared connection',
    description: ADF_DESCRIPTION,
    status: { name: 'In Progress', statusCategory: { key: 'indeterminate' } },
    assignee: { displayName: 'Andrew', emailAddress: 'andrew.tavares87@gmail.com' },
    labels: ['improvement'],
    updated: '2026-08-22T11:30:00.000+0000',
    resolutiondate: null,
  },
}

export const ISSUE_DONE = {
  id: '10008',
  key: 'TAV-8',
  fields: {
    summary: 'Contrast fixes',
    description: null,
    status: { name: 'Done', statusCategory: { key: 'done' } },
    assignee: null,
    labels: [],
    updated: '2026-08-19T08:00:00.000+0000',
    resolutiondate: '2026-08-19T08:00:00.000+0000',
  },
}

/** First page — carries a nextPageToken, so a provider must follow it. */
export const SEARCH_PAGE_1 = {
  issues: [ISSUE_TAV_7],
  nextPageToken: 'token-page-2',
  isLast: false,
}

export const SEARCH_PAGE_2 = {
  issues: [ISSUE_DONE],
  isLast: true,
}

export const COMMENTS = {
  comments: [
    {
      author: { displayName: 'Andrew' },
      created: '2026-08-22T10:15:00.000+0000',
      body: {
        type: 'doc',
        version: 1,
        content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Verified against v3.' }] }],
      },
    },
  ],
}

export const SITE = 'tav.atlassian.net'
export const CREDENTIAL = {
  tracker: 'jira' as const,
  site: SITE,
  email: 'andrew.tavares87@gmail.com',
  apiToken: 'token-abc',
}
