import { describe, expect, it, vi } from 'vitest'
import { fileIssue, reportingStatus } from '../../../src/bug-report/gh-report'
import type { ShellExecInput, ShellExecOutput } from '../../../src/shell/shell-executor'

function output(overrides: Partial<ShellExecOutput> = {}): ShellExecOutput {
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
  return vi.fn(async (_input: ShellExecInput) => outputs.shift() ?? output())
}

const CREATE_ARGS = [
  'issue',
  'create',
  '--repo',
  'andytavares/terminator',
  '--title',
  'Diff view goes blank',
  '--body-file',
  '-',
]
const HELP_WITH_ATTACH = output({
  stdout: 'FLAGS\n  --attach file   Attach an image or video file\n',
})

describe('reportingStatus', () => {
  it('is ready, as the signed-in account, when gh can attach files', async () => {
    const run = fakeGh(HELP_WITH_ATTACH, output({ stdout: 'octocat\n' }))

    await expect(reportingStatus(run, '/home/me')).resolves.toEqual({
      ready: true,
      login: 'octocat',
    })
    expect(run.mock.calls[0][0]).toMatchObject({
      command: 'gh',
      args: ['issue', 'create', '--help'],
    })
    expect(run.mock.calls[1][0]).toMatchObject({
      command: 'gh',
      args: ['api', 'user', '--hostname', 'github.com', '--jq', '.login'],
    })
  })
})

describe('reportingStatus, not ready', () => {
  it('is not ready when gh is not installed', async () => {
    const run = fakeGh(output({ exitCode: 127, stderr: 'spawn gh ENOENT' }))

    await expect(reportingStatus(run, '/home/me')).resolves.toEqual({
      ready: false,
      reason: 'no-gh',
    })
  })

  it('is not ready when this gh is too old to attach files', async () => {
    const run = fakeGh(output({ stdout: 'FLAGS\n  --body string\n' }))

    await expect(reportingStatus(run, '/home/me')).resolves.toEqual({
      ready: false,
      reason: 'no-attach',
    })
  })

  it('is not ready when gh is signed out of github.com', async () => {
    const run = fakeGh(
      HELP_WITH_ATTACH,
      output({ exitCode: 4, stderr: 'To get started with GitHub CLI, please run:  gh auth login' })
    )

    await expect(reportingStatus(run, '/home/me')).resolves.toEqual({
      ready: false,
      reason: 'signed-out',
    })
  })
})

describe('fileIssue, posted', () => {
  it('creates the issue on the app repository with each file attached, the body over stdin', async () => {
    const run = fakeGh(output({ stdout: 'https://github.com/andytavares/terminator/issues/418\n' }))

    const filed = await fileIssue(run, '/home/me', {
      title: 'Diff view goes blank',
      body: 'What happened',
      files: ['/reports/a/window.png', '/picked/repro.mov'],
    })

    expect(filed).toEqual({
      ok: true,
      number: 418,
      url: 'https://github.com/andytavares/terminator/issues/418',
    })
    expect(run.mock.calls[0][0]).toMatchObject({
      command: 'gh',
      cwd: '/home/me',
      input: 'What happened',
      args: [...CREATE_ARGS, '--attach', '/reports/a/window.png', '--attach', '/picked/repro.mov'],
    })
  })
})

describe('fileIssue, failed', () => {
  it('reports a sign-in failure as signed out, so the user knows to sign in again', async () => {
    const run = fakeGh(
      output({ exitCode: 1, stderr: 'HTTP 401: Bad credentials\nTry gh auth login' })
    )

    await expect(fileIssue(run, '/home/me', { title: 't', body: 'b', files: [] })).resolves.toEqual(
      {
        ok: false,
        error: 'SIGNED_OUT',
        message: 'HTTP 401: Bad credentials\nTry gh auth login',
      }
    )
  })

  it('reports any other failure with what gh said', async () => {
    const run = fakeGh(output({ exitCode: 1, stderr: 'upload failed: file too large' }))

    await expect(fileIssue(run, '/home/me', { title: 't', body: 'b', files: [] })).resolves.toEqual(
      {
        ok: false,
        error: 'FAILED',
        message: 'upload failed: file too large',
      }
    )
  })
})

describe('fileIssue, timed out', () => {
  it('reports a timed-out upload as a failure that says so', async () => {
    const run = fakeGh(output({ exitCode: 124, timedOut: true }))

    await expect(fileIssue(run, '/home/me', { title: 't', body: 'b', files: [] })).resolves.toEqual(
      {
        ok: false,
        error: 'FAILED',
        message: 'GitHub did not answer in time.',
      }
    )
  })
})
