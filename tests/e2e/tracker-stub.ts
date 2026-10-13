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

const LINEAR_HOST = 'api.linear.app'
export const JIRA_SITE = 'acme.atlassian.net'

export interface TrackerStub {
  /** Environment the app needs for its tracker calls to reach this stub. */
  env: Record<string, string>
  linear: LinearState
  jira: JiraState
  /** Each tunnel the app opened and each TLS handshake it refused, for a failure message. */
  diagnostics: string[]
  close(): Promise<void>
}

// Every extension and the digest are written out, so the certificates do not
// depend on which openssl runs: macOS ships LibreSSL, Linux OpenSSL 3, and their
// defaults differ (OpenSSL 3 adds key identifiers unasked).
const CA_EXTENSIONS = [
  'basicConstraints=critical,CA:TRUE',
  'keyUsage=critical,keyCertSign,cRLSign',
  'subjectKeyIdentifier=hash',
]
const LEAF_EXTENSIONS = [
  `subjectAltName=DNS:${LINEAR_HOST},DNS:${JIRA_SITE}`,
  'basicConstraints=CA:FALSE',
  'keyUsage=critical,digitalSignature,keyEncipherment',
  'extendedKeyUsage=serverAuth',
  'subjectKeyIdentifier=hash',
  'authorityKeyIdentifier=keyid,issuer',
]

/** A CA and a server certificate for both hosts, with openssl(1) commands LibreSSL also takes. */
function makeCertificates(dir: string): { ca: string; key: Buffer; cert: Buffer } {
  const openssl = (args: string) =>
    execFileSync('openssl', args.split(' '), { cwd: dir, stdio: 'pipe' })
  writeFileSync(join(dir, 'ca.ext'), CA_EXTENSIONS.join('\n'))
  writeFileSync(join(dir, 'leaf.ext'), LEAF_EXTENSIONS.join('\n'))
  const sign = '-req -sha256 -days 2 -set_serial'
  for (const name of ['ca', 'leaf']) {
    openssl(`genrsa -out ${name}.key 2048`)
    openssl(`req -new -sha256 -key ${name}.key -subj /CN=terminator-e2e-${name} -out ${name}.csr`)
  }
  openssl(`x509 ${sign} 1 -in ca.csr -signkey ca.key -extfile ca.ext -out ca.pem`)
  openssl(`x509 ${sign} 2 -in leaf.csr -CA ca.pem -CAkey ca.key -extfile leaf.ext -out leaf.pem`)
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

/** Answers TLS for both hosts itself, each request by the host it names. */
function trackerServer(linear: LinearState, jira: JiraState, key: Buffer, cert: Buffer) {
  return createHttpsServer({ key, cert }, (request, response) => {
    void readJson(request).then((body) => {
      const host = request.headers.host ?? ''
      const answer =
        host === LINEAR_HOST ? answerLinear(linear, request, body) : answerJira(jira, request, body)
      reply(response, answer.status, answer.body)
    })
  })
}

/** A CONNECT proxy that tunnels the two tracker hosts to `tls` and refuses every other. */
function trackerProxy(tls: ReturnType<typeof trackerServer>, diagnostics: string[]) {
  tls.on('tlsClientError', (error) => diagnostics.push(`TLS: ${error.message}`))
  const proxy = createHttpServer((_request, response) => reply(response, 403, {}))
  const tunnels = new Set<Socket>()
  proxy.on('connect', (request: IncomingMessage, socket: Socket) => {
    tunnels.add(socket)
    socket.on('close', () => tunnels.delete(socket))
    const host = (request.url ?? '').split(':')[0]
    diagnostics.push(`CONNECT ${request.url}`)
    if (host !== LINEAR_HOST && host !== JIRA_SITE) {
      socket.end('HTTP/1.1 403 Forbidden\r\n\r\n')
      return
    }
    socket.write('HTTP/1.1 200 Connection Established\r\n\r\n')
    tls.emit('connection', socket)
  })
  return { proxy, tunnels }
}

/**
 * Closes the proxy without waiting on its clients. A tunnel the app left open
 * (keep-alive, or a test that failed mid-request) would keep `server.close()`
 * pending forever, so every tunnel and idle connection is destroyed first.
 */
function closeProxy(proxy: ReturnType<typeof createHttpServer>, tunnels: Set<Socket>) {
  for (const socket of tunnels) socket.destroy()
  proxy.closeAllConnections()
  return new Promise<void>((resolve) => proxy.close(() => resolve()))
}

function proxyEnvironment(url: string, ca: string): Record<string, string> {
  const noProxy = '127.0.0.1,localhost'
  return {
    NODE_USE_ENV_PROXY: '1',
    ...{ HTTPS_PROXY: url, https_proxy: url, HTTP_PROXY: url, http_proxy: url },
    ...{ NO_PROXY: noProxy, no_proxy: noProxy },
    NODE_EXTRA_CA_CERTS: ca,
  }
}

/** Starts the stub; pass its `env` to `launchApp`. */
export async function startTrackerStub(linear: LinearState, jira: JiraState): Promise<TrackerStub> {
  const { ca, key, cert } = makeCertificates(
    mkdtempSync(join(tmpdir(), 'terminator-e2e-trackers-'))
  )
  const diagnostics: string[] = []
  const { proxy, tunnels } = trackerProxy(trackerServer(linear, jira, key, cert), diagnostics)
  await new Promise<void>((resolve) => proxy.listen(0, '127.0.0.1', resolve))
  const url = `http://127.0.0.1:${(proxy.address() as AddressInfo).port}`
  return {
    env: proxyEnvironment(url, ca),
    linear,
    jira,
    diagnostics,
    close: () => closeProxy(proxy, tunnels),
  }
}
