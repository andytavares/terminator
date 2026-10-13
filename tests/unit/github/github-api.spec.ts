import { describe, it, expect, vi } from 'vitest'
import type { GithubCommandError } from '@terminator/extension-sdk'
import { createGithubApi } from '../../../src/main/github/github-api'
import type { ShellExecInput, ShellExecOutput } from '../../../src/main/shell/shell-executor'

function result(overrides: Partial<ShellExecOutput> = {}): ShellExecOutput {
  return {
    exitCode: 0,
    stdout: '',
    stderr: '',
    timedOut: false,
    exceededMaxBuffer: false,
    ...overrides,
  }
}

function fakeGh(...outputs: ShellExecOutput[]) {
  const run = vi.fn(async (_input: ShellExecInput) => outputs.shift() ?? result())
  return { run, github: createGithubApi(run) }
}

describe('api.github', () => {
  it('runs gh for a repository without a checkout through GH_REPO', async () => {
    const { run, github } = fakeGh(result({ stdout: '{"number":7,"state":"OPEN"}\n' }))

    const pullRequest = await github.pullRequests.view(
      { cwd: '/home/me', repository: 'octo/repo' },
      7,
      ['number', 'state']
    )

    expect(pullRequest).toEqual({ number: 7, state: 'OPEN' })
    expect(run.mock.calls[0][0]).toMatchObject({
      command: 'gh',
      args: ['pr', 'view', '7', '--json', 'number,state'],
      cwd: '/home/me',
      env: { GH_REPO: 'octo/repo' },
    })
  })

  it('retries without the configured token when gh rejects it, so gh login still works', async () => {
    const { run, github } = fakeGh(
      result({ exitCode: 1, stderr: 'HTTP 401: Bad credentials' }),
      result({ stdout: 'alice\n' })
    )

    const login = await github.api(
      { cwd: '/repo', token: 'expired' },
      { path: 'user', jq: '.login' }
    )

    expect(login).toBe('alice\n')
    expect(run.mock.calls.map(([input]) => input.env)).toEqual([{ GH_TOKEN: 'expired' }, {}])
  })
})

describe('api.github — request bodies', () => {
  it('sends a JSON body on stdin and rejects with what gh printed when GitHub refuses it', async () => {
    const refusal = '{"message":"Validation Failed"}'
    const { run, github } = fakeGh(
      result({ exitCode: 1, stdout: refusal, stderr: 'gh: Unprocessable Entity (HTTP 422)\n' })
    )

    const request = github.api(
      { cwd: '/repo' },
      { path: 'repos/o/r/pulls/1/reviews', method: 'POST', body: { event: 'APPROVE' } }
    )

    await expect(request).rejects.toMatchObject({
      message: 'gh: Unprocessable Entity (HTTP 422)',
      stdout: refusal,
      exitCode: 1,
      authenticationFailed: false,
    } satisfies Partial<GithubCommandError>)
    expect(run.mock.calls[0][0]).toMatchObject({
      args: ['api', 'repos/o/r/pulls/1/reviews', '--method', 'POST', '--input', '-'],
      input: '{"event":"APPROVE"}',
    })
  })
})

describe('api.github — gh api command lines', () => {
  it('puts string and typed parameters, paging and a jq filter on the gh api command line', async () => {
    const { run, github } = fakeGh(result({ stdout: '[]' }))

    await github.api(
      { cwd: '/repo' },
      {
        path: 'graphql',
        fields: { query: 'query($n:Int!){x}' },
        typedFields: { n: 5 },
        paginate: true,
        jq: '.data',
      }
    )

    expect(run.mock.calls[0][0].args).toEqual([
      'api',
      'graphql',
      '--paginate',
      '-f',
      'query=query($n:Int!){x}',
      '-F',
      'n=5',
      '--jq',
      '.data',
    ])
  })
})

describe('api.github — pull requests, repositories and timeouts', () => {
  it('opens a pull request and reads its number from the URL gh prints', async () => {
    const { run, github } = fakeGh(result({ stdout: 'https://github.com/o/r/pull/42\n' }))

    const created = await github.pullRequests.create(
      { cwd: '/repo' },
      { title: 'T', body: 'B', base: 'main', head: 'feat', draft: true }
    )

    expect(created).toEqual({ number: 42, url: 'https://github.com/o/r/pull/42' })
    expect(run.mock.calls[0][0].args).toEqual([
      'pr',
      'create',
      '--title',
      'T',
      '--body',
      'B',
      '--base',
      'main',
      '--head',
      'feat',
      '--draft',
    ])
  })
})

describe('api.github — repositories and timeouts', () => {
  it('reads the repository a checkout belongs to', async () => {
    const { run, github } = fakeGh(result({ stdout: '{"name":"repo","owner":{"login":"octo"}}' }))

    const repository = await github.repositories.view({ cwd: '/repo' }, ['owner', 'name'])

    expect(repository).toEqual({ name: 'repo', owner: { login: 'octo' } })
    expect(run.mock.calls[0][0].args).toEqual(['repo', 'view', '--json', 'owner,name'])
  })

  it('marks a timeout as a failure', async () => {
    const { github } = fakeGh(result({ exitCode: 124, timedOut: true }))

    await expect(github.pullRequests.markReady({ cwd: '/repo' }, 3)).rejects.toMatchObject({
      timedOut: true,
      exitCode: 124,
    })
  })
})
