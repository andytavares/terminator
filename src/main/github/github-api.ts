import type {
  GithubAPI,
  GithubApiRequest,
  GithubCommandError,
  GithubTarget,
} from '@terminator/extension-sdk'
import type { ShellExecInput, ShellExecOutput } from '../shell/shell-executor.js'

/** Runs one command; `execShell` in the app, a fake in tests. */
export type RunCommand = (input: ShellExecInput) => Promise<ShellExecOutput>

const DEFAULT_TIMEOUT_MS = 30_000

interface GhCall {
  target: GithubTarget
  args: string[]
  timeoutMs?: number
  maxBuffer?: number
  input?: string
}

function isAuthenticationFailure(output: ShellExecOutput): boolean {
  const text = `${output.stderr}\n${output.stdout}`
  return text.includes('gh auth login') || text.includes('GH_TOKEN') || text.includes('401')
}

class GhCommandError extends Error implements GithubCommandError {
  readonly stdout: string
  readonly stderr: string
  readonly exitCode: number
  readonly timedOut: boolean
  readonly exceededMaxBuffer: boolean
  readonly authenticationFailed: boolean

  constructor(output: ShellExecOutput) {
    super(output.stderr.trim() || `gh exited with code ${output.exitCode}`)
    this.name = 'GithubCommandError'
    this.stdout = output.stdout
    this.stderr = output.stderr
    this.exitCode = output.exitCode
    this.timedOut = output.timedOut
    this.exceededMaxBuffer = output.exceededMaxBuffer
    this.authenticationFailed = isAuthenticationFailure(output)
  }
}

function environment(target: GithubTarget, token: string | undefined): Record<string, string> {
  return {
    ...(target.repository ? { GH_REPO: target.repository } : {}),
    ...(token ? { GH_TOKEN: token } : {}),
  }
}

function apiArguments(request: GithubApiRequest): string[] {
  const args = ['api', request.path]
  if (request.method) args.push('--method', request.method)
  if (request.paginate) args.push('--paginate')
  if (request.accept) args.push('-H', `Accept: ${request.accept}`)
  for (const [name, value] of Object.entries(request.fields ?? {}))
    args.push('-f', `${name}=${value}`)
  for (const [name, value] of Object.entries(request.typedFields ?? {})) {
    args.push('-F', `${name}=${value}`)
  }
  if (request.body !== undefined) args.push('--input', '-')
  if (request.jq) args.push('--jq', request.jq)
  return args
}

/** Number and URL from the URL `gh pr create` prints. */
function createdPullRequest(stdout: string): { number: number; url: string } {
  const url = stdout.trim()
  const number = Number(/\/pull\/(\d+)$/.exec(url)?.[1] ?? 0)
  return { number, url }
}

type Gh = (call: GhCall) => Promise<string>

function ghRunner(run: RunCommand): Gh {
  return async (call) => {
    const attempt = (token: string | undefined) =>
      run({
        command: 'gh',
        args: call.args,
        cwd: call.target.cwd,
        timeoutMs: call.timeoutMs ?? DEFAULT_TIMEOUT_MS,
        ...(call.maxBuffer === undefined ? {} : { maxBuffer: call.maxBuffer }),
        ...(call.input === undefined ? {} : { input: call.input }),
        env: environment(call.target, token),
      })
    let output = await attempt(call.target.token)
    // An expired configured token must not hide gh's own login, which may still work.
    if (output.exitCode !== 0 && call.target.token && isAuthenticationFailure(output)) {
      output = await attempt(undefined)
    }
    if (output.exitCode !== 0) throw new GhCommandError(output)
    return output.stdout
  }
}

function pullRequestVerbs(gh: Gh): GithubAPI['pullRequests'] {
  const json = async <T>(call: GhCall) => JSON.parse(await gh(call)) as T
  return {
    view: (target, pullRequest, fields) =>
      json({ target, args: ['pr', 'view', String(pullRequest), '--json', fields.join(',')] }),
    list: (target, { state, search, limit, fields }) => {
      const args = ['pr', 'list', '--state', state, ...(search ? ['--search', search] : [])]
      args.push('--limit', String(limit), '--json', fields.join(','))
      return json({ target, args })
    },
    create: async (target, { title, body, base, head, draft }) => {
      const args = ['pr', 'create', '--title', title, '--body', body, '--base', base]
      args.push('--head', head, ...(draft ? ['--draft'] : []))
      return createdPullRequest(await gh({ target, args }))
    },
    markReady: async (target, pullRequest) => {
      await gh({ target, args: ['pr', 'ready', String(pullRequest)] })
    },
    updateBranch: async (target, pullRequest) => {
      await gh({ target, args: ['pr', 'update-branch', String(pullRequest), '--rebase=false'] })
    },
  }
}

export function createGithubApi(run: RunCommand): GithubAPI {
  const gh = ghRunner(run)
  return {
    api: (target, request) =>
      gh({
        target,
        args: apiArguments(request),
        timeoutMs: request.timeoutMs,
        maxBuffer: request.maxBuffer,
        input: request.body === undefined ? undefined : JSON.stringify(request.body),
      }),
    pullRequests: pullRequestVerbs(gh),
    repositories: {
      view: async (target, fields) =>
        JSON.parse(await gh({ target, args: ['repo', 'view', '--json', fields.join(',')] })),
      clone: async (target, repository, directory) => {
        await gh({ target, args: ['repo', 'clone', repository, directory] })
      },
    },
  }
}
