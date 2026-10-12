import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import {
  createServer as createHttpServer,
  type IncomingMessage,
  type ServerResponse,
} from 'node:http'
import { createServer as createHttpsServer } from 'node:https'
import type { AddressInfo, Socket } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { answerJira, type JiraState } from './tracker-stub-jira'
import { answerLinear, type LinearState } from './tracker-stub-linear'

// Stub Linear and Jira for the e2e suite, reached at their real addresses.
// The core calls https://api.linear.app/graphql (the Linear SDK) and
// https://<site>/rest/api/3 (Jira) with Node's fetch. The app is started with
// NODE_USE_ENV_PROXY=1 and HTTPS_PROXY naming this local proxy, which Node's
// fetch then tunnels through (https://nodejs.org/api/cli.html#node_use_env_proxy1),
// and NODE_EXTRA_CA_CERTS naming a certificate authority made for this run
// (https://nodejs.org/api/cli.html#node_extra_ca_certsfile), so the proxy can
// answer TLS for those hosts itself. Every other host is refused: nothing
// leaves the machine.

export const LINEAR_HOST = 'api.linear.app'
export const JIRA_SITE = 'acme.atlassian.net'

export interface TrackerStub {
  /** Environment the app needs for its tracker calls to reach this stub. */
  env: Record<string, string>
  linear: LinearState
  jira: JiraState
  close(): Promise<void>
}

/** A CA and a server certificate for both hosts, with openssl(1). */
function makeCertificates(dir: string): { ca: string; key: Buffer; cert: Buffer } {
  const openssl = (...args: string[]) => execFileSync('openssl', args, { cwd: dir, stdio: 'pipe' })
  openssl(
    'req',
    '-x509',
    '-newkey',
    'rsa:2048',
    '-nodes',
    '-keyout',
    'ca.key',
    '-out',
    'ca.pem',
    '-days',
    '2',
    '-subj',
    '/CN=terminator-e2e-ca',
    '-addext',
    'basicConstraints=critical,CA:TRUE',
    '-addext',
    'keyUsage=critical,keyCertSign'
  )
  openssl(
    'req',
    '-newkey',
    'rsa:2048',
    '-nodes',
    '-keyout',
    'leaf.key',
    '-out',
    'leaf.csr',
    '-subj',
    '/CN=stub'
  )
  writeFileSync(
    join(dir, 'leaf.ext'),
    `subjectAltName=DNS:${LINEAR_HOST},DNS:${JIRA_SITE}\nextendedKeyUsage=serverAuth\n`
  )
  openssl(
    'x509',
    '-req',
    '-in',
    'leaf.csr',
    '-CA',
    'ca.pem',
    '-CAkey',
    'ca.key',
    '-CAcreateserial',
    '-out',
    'leaf.pem',
    '-days',
    '2',
    '-extfile',
    'leaf.ext'
  )
  return {
    ca: join(dir, 'ca.pem'),
    key: readFileSync(join(dir, 'leaf.key')),
    cert: readFileSync(join(dir, 'leaf.pem')),
  }
}

function readJson(request: IncomingMessage): Promise<unknown> {
  return new Promise((resolve) => {
    let body = ''
    request.on('data', (chunk) => (body += chunk))
    request.on('end', () => resolve(body ? JSON.parse(body) : null))
  })
}

function reply(response: ServerResponse, status: number, body: unknown): void {
  response.writeHead(status, { 'content-type': 'application/json' })
  response.end(JSON.stringify(body))
}

/** Starts the stub; pass its `env` to `launchApp`. */
export async function startTrackerStub(linear: LinearState, jira: JiraState): Promise<TrackerStub> {
  const dir = mkdtempSync(join(tmpdir(), 'terminator-e2e-trackers-'))
  const { ca, key, cert } = makeCertificates(dir)
  const tls = createHttpsServer({ key, cert }, (request, response) => {
    void readJson(request).then((body) => {
      const host = request.headers.host ?? ''
      const answer =
        host === LINEAR_HOST ? answerLinear(linear, request, body) : answerJira(jira, request, body)
      reply(response, answer.status, answer.body)
    })
  })
  const proxy = createHttpServer((_request, response) => reply(response, 403, {}))
  proxy.on('connect', (request: IncomingMessage, socket: Socket) => {
    const host = (request.url ?? '').split(':')[0]
    if (host !== LINEAR_HOST && host !== JIRA_SITE) {
      socket.end('HTTP/1.1 403 Forbidden\r\n\r\n')
      return
    }
    socket.write('HTTP/1.1 200 Connection Established\r\n\r\n')
    tls.emit('connection', socket)
  })
  await new Promise<void>((resolve) => proxy.listen(0, '127.0.0.1', resolve))
  const url = `http://127.0.0.1:${(proxy.address() as AddressInfo).port}`
  return {
    env: {
      NODE_USE_ENV_PROXY: '1',
      HTTPS_PROXY: url,
      https_proxy: url,
      HTTP_PROXY: url,
      http_proxy: url,
      NO_PROXY: '127.0.0.1,localhost',
      no_proxy: '127.0.0.1,localhost',
      NODE_EXTRA_CA_CERTS: ca,
    },
    linear,
    jira,
    close: () => new Promise((resolve) => proxy.close(() => resolve())),
  }
}
