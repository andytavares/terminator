import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { createServer, type IncomingMessage, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  addPullRequest,
  findPullRequest,
  handleGhCall,
  type GhCall,
  type NewStubPullRequest,
  type StubContext,
  type StubPullRequest,
} from './github-stub-gh'

// A stub GitHub for the e2e suite, at the boundary the app really has: the gh
// CLI. The core runs every gh command for the extensions (api.github, ADR 094);
// `tests/e2e/fixtures/bin/gh` stands in for gh on the app's PATH and forwards
// each call here when the app's XDG_CONFIG_HOME, where gh reads its own
// config, holds gh/e2e-stub-url. Pull requests live in a local bare repository,
// so their branches, diffs and `pull/N/head` refs are real git, fetched by the
// app exactly as it fetches them from GitHub. What gh answers is in
// `github-stub-gh.ts`.

export interface GithubStubOptions {
  /** The bare repository standing in for github.com/<owner>/<name>. */
  bareRepo: string
  owner?: string
  name?: string
  viewer?: string
}

export interface GithubStub {
  owner: string
  name: string
  viewer: string
  /** Environment the app needs for its gh calls to reach this stub. */
  env: Record<string, string>
  pullRequests: StubPullRequest[]
  /** Every gh command the app ran, in order. */
  calls: GhCall[]
  openPullRequest(input: NewStubPullRequest): StubPullRequest
  pullRequest(number: number): StubPullRequest
  close(): Promise<void>
}

/** Starts the stub; pass its `env` to `launchApp`. */
export async function startGithubStub(options: GithubStubOptions): Promise<GithubStub> {
  const context = stubContext(options)
  const calls: GhCall[] = []
  const server = ghServer(context, calls)
  const configHome = await listen(server)
  return {
    owner: context.owner,
    name: context.name,
    viewer: context.viewer,
    env: { XDG_CONFIG_HOME: configHome },
    pullRequests: context.pullRequests,
    calls,
    openPullRequest: (input) => addPullRequest(context, input),
    pullRequest: (number) => findPullRequest(context, number),
    // Drops idle and in-flight connections first, so a call the app left
    // open when a test failed cannot keep close() pending.
    close: () => {
      server.closeAllConnections()
      return new Promise((resolve) => server.close(() => resolve()))
    },
  }
}

function stubContext(options: GithubStubOptions): StubContext {
  let lastId = 1000
  return {
    bareRepo: options.bareRepo,
    owner: options.owner ?? 'acme',
    name: options.name ?? 'widgets',
    viewer: options.viewer ?? 'e2e-reviewer',
    pullRequests: [],
    nextId: () => ++lastId,
  }
}

/** Answers each forwarded gh call, and records it in `calls`. */
function ghServer(context: StubContext, calls: GhCall[]): Server {
  return createServer((request, response) => {
    void readBody(request).then((raw) => {
      const call = JSON.parse(raw) as GhCall
      calls.push(call)
      response.setHeader('content-type', 'application/json')
      response.end(JSON.stringify(handleGhCall(context, call)))
    })
  })
}

function readBody(request: IncomingMessage): Promise<string> {
  return new Promise((resolve) => {
    let body = ''
    request.on('data', (chunk) => (body += chunk))
    request.on('end', () => resolve(body))
  })
}

/** Listens on a free port and writes gh/e2e-stub-url, where the gh stand-in looks. */
async function listen(server: Server): Promise<string> {
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const { port } = server.address() as AddressInfo
  const configHome = mkdtempSync(join(tmpdir(), 'terminator-e2e-gh-'))
  mkdirSync(join(configHome, 'gh'))
  writeFileSync(join(configHome, 'gh', 'e2e-stub-url'), `http://127.0.0.1:${port}/`)
  return configHome
}
