import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:https'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, type Page } from '@playwright/test'
import { closeSettingsPanel, openSettingsSection } from './helpers'
import { readJsonBody, sendJson, type StubServer } from './stub-http'

// A local Jira Cloud REST v3. The app's Jira client speaks only https, so the stub serves TLS
// from a throwaway CA the app trusts through NODE_EXTRA_CA_CERTS
// (https://nodejs.org/api/cli.html#node_extra_ca_certsfile).

export interface StubIssue {
  key: string
  summary: string
  description: string
  status: 'To Do' | 'In Progress' | 'Done'
}

export interface JiraStub extends StubServer {
  /** What the app's "Site" field takes: host and port, no scheme. */
  site: string
  /** The CA the app must trust, for NODE_EXTRA_CA_CERTS. */
  caPath: string
  /** Every request the app made, as "METHOD path?query". */
  requests: string[]
  /** Comments the app posted, by issue key, as plain text. */
  comments: Map<string, string[]>
}

const OPERATOR = 'operator@example.com'

const CATEGORY: Record<StubIssue['status'], string> = {
  'To Do': 'new',
  'In Progress': 'indeterminate',
  Done: 'done',
}

const OPENSSL_CONFIG = `[req]
distinguished_name = dn
prompt = no
[dn]
CN = 127.0.0.1
[leaf]
basicConstraints = CA:FALSE
keyUsage = digitalSignature, keyEncipherment
extendedKeyUsage = serverAuth
subjectAltName = IP:127.0.0.1
[ca]
basicConstraints = critical, CA:TRUE
keyUsage = critical, keyCertSign, cRLSign
`

/** A CA and a certificate for 127.0.0.1 it signed, written to a fresh directory. */
function issueCertificate(): { caPath: string; keyPath: string; certPath: string } {
  const dir = mkdtempSync(join(tmpdir(), 'terminator-e2e-tls-'))
  const inCertDir = (name: string) => join(dir, name)
  writeFileSync(inCertDir('openssl.cnf'), OPENSSL_CONFIG)
  const runOpenssl = (...args: string[]) => execFileSync('openssl', args, { stdio: 'pipe' })
  runOpenssl(
    ...['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '2', '-subj', '/CN=e2e CA'],
    ...['-keyout', inCertDir('ca.key'), '-out', inCertDir('ca.pem')],
    ...['-config', inCertDir('openssl.cnf'), '-extensions', 'ca']
  )
  runOpenssl(
    ...['req', '-newkey', 'rsa:2048', '-nodes', '-keyout', inCertDir('server.key')],
    ...['-out', inCertDir('server.csr'), '-config', inCertDir('openssl.cnf')]
  )
  runOpenssl(
    ...['x509', '-req', '-in', inCertDir('server.csr'), '-CA', inCertDir('ca.pem')],
    ...['-CAkey', inCertDir('ca.key'), '-CAcreateserial', '-days', '2'],
    ...['-out', inCertDir('server.pem')],
    ...['-extfile', inCertDir('openssl.cnf'), '-extensions', 'leaf']
  )
  return {
    caPath: inCertDir('ca.pem'),
    keyPath: inCertDir('server.key'),
    certPath: inCertDir('server.pem'),
  }
}

function toJira(issue: StubIssue, site: string) {
  return {
    id: issue.key.replace(/\D/g, ''),
    key: issue.key,
    self: `https://${site}/rest/api/3/issue/${issue.key}`,
    fields: {
      summary: issue.summary,
      description: {
        type: 'doc',
        version: 1,
        content: [{ type: 'paragraph', content: [{ type: 'text', text: issue.description }] }],
      },
      status: { name: issue.status, statusCategory: { key: CATEGORY[issue.status] } },
      assignee: { displayName: 'E2E Operator', emailAddress: OPERATOR },
      labels: ['e2e'],
      updated: '2026-10-01T09:00:00.000+0000',
      resolutiondate: null,
    },
  }
}

/** The search term in `text ~ "term"`, or null for any other query (the "mine" query). */
function searchTerm(jql: string): string | null {
  return /text ~ "((?:[^"\\]|\\.)*)"/.exec(jql)?.[1] ?? null
}

function commentBodyText(body: unknown): string {
  const content = (body as { body?: { content?: Array<{ content?: Array<{ text?: string }> }> } })
    ?.body?.content
  return (content ?? []).flatMap((block) => (block.content ?? []).map((n) => n.text ?? '')).join('')
}

interface StubState {
  issues: StubIssue[]
  site: () => string
  comments: Map<string, string[]>
}

interface StubRequest {
  method: string
  url: URL
  body: unknown
}

type Answer = { status: number; body: unknown }

function searchAnswer(state: StubState, url: URL): Answer {
  const term = searchTerm(url.searchParams.get('jql') ?? '')
  const hits = state.issues.filter(
    (i) => term === null || `${i.key} ${i.summary}`.toLowerCase().includes(term.toLowerCase())
  )
  return { status: 200, body: { issues: hits.map((i) => toJira(i, state.site())), isLast: true } }
}

function commentAnswer(state: StubState, key: string, request: StubRequest): Answer {
  if (request.method !== 'POST') return { status: 200, body: { comments: [] } }
  state.comments.set(key, [...(state.comments.get(key) ?? []), commentBodyText(request.body)])
  return { status: 201, body: {} }
}

function routeJira(state: StubState, request: StubRequest): Answer {
  const path = request.url.pathname.replace(/^\/rest\/api\/3/, '')
  if (path === '/myself') {
    return { status: 200, body: { displayName: 'E2E Operator', emailAddress: OPERATOR } }
  }
  if (path === '/search/jql') return searchAnswer(state, request.url)
  const comment = /^\/issue\/([^/]+)\/comment$/.exec(path)
  if (comment) return commentAnswer(state, decodeURIComponent(comment[1]), request)
  const issue = /^\/issue\/([^/]+)$/.exec(path)
  const found = issue && state.issues.find((i) => i.key === decodeURIComponent(issue[1]))
  if (found) return { status: 200, body: toJira(found, state.site()) }
  return { status: 404, body: { errorMessages: ['Issue does not exist'] } }
}

/** Connects Jira through Settings → Integrations, against the stub. */
export async function connectJira(page: Page, stub: JiraStub): Promise<void> {
  await openSettingsSection(page, 'Integrations')
  await page.locator('#jira-site').fill(stub.site)
  await page.locator('#jira-email').fill('operator@example.com')
  await page.locator('#jira-token').fill('e2e-token')
  await page.getByRole('button', { name: 'Connect Jira' }).click()
  await expect(page.locator('.integrations__tracker', { hasText: 'Jira' })).toContainText(
    `Connected as operator@example.com · ${stub.site}`
  )
  await closeSettingsPanel(page)
}

/** Starts the stub on a free port, answering for `issues`. */
export async function startJiraStub(issues: StubIssue[]): Promise<JiraStub> {
  const { caPath, keyPath, certPath } = issueCertificate()
  const requests: string[] = []
  const comments = new Map<string, string[]>()
  let site = ''
  const state: StubState = { issues, site: () => site, comments }
  const server = createServer(
    { key: readFileSync(keyPath), cert: readFileSync(certPath) },
    (request, response) => {
      void (async () => {
        const url = new URL(request.url ?? '/', `https://${site}`)
        const method = request.method ?? 'GET'
        requests.push(`${method} ${url.pathname}${url.search}`)
        const answer = routeJira(state, { method, url, body: await readJsonBody(request) })
        sendJson(response, answer.status, answer.body)
      })()
    }
  )
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  site = `127.0.0.1:${(server.address() as AddressInfo).port}`
  return {
    site,
    caPath,
    requests,
    comments,
    shutDown: () => new Promise((resolve) => server.close(() => resolve())),
  }
}
