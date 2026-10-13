import { execFile } from 'node:child_process'
import type { ExtensionAPI, GithubAPI, ShellExecResult } from '@terminator/extension-sdk'
import { bindShell } from '../../../src/shell/run-git'
import { createGithubApi } from '../../../../../src/main/github/github-api'

// The extension's commands run through the core's shell.exec. These stand-ins
// let a spec keep stubbing a promisified execFile `(cmd, args, opts, cb)`, or
// run real git, behind that one entry point.

type ExecFileStub = (...args: unknown[]) => unknown
type Exec = ExtensionAPI['shell']['exec']

interface StubError extends Error {
  code?: string | number
  stdout?: string
  stderr?: string
}

function toResult(error: StubError | null, out?: { stdout?: string; stderr?: string }) {
  if (!error) {
    const stdout = out?.stdout ?? ''
    const stderr = out?.stderr ?? ''
    return { exitCode: 0, stdout, stderr, timedOut: false, exceededMaxBuffer: false }
  }
  const result: ShellExecResult = {
    exitCode: typeof error.code === 'number' ? error.code : 1,
    stdout: error.stdout ?? '',
    stderr: error.stderr || error.message,
    timedOut: false,
    exceededMaxBuffer: error.code === 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER',
  }
  return result
}

type ExecFileCallback = (error: StubError | null, out?: { stdout: string; stderr: string }) => void

/** An execFile stub answer that prints `stdout`; execFile's callback is always its last argument. */
export function stubPrints(stdout: string): ExecFileStub {
  return (...args) => (args.at(-1) as ExecFileCallback)(null, { stdout, stderr: '' })
}

/** One call an execFile stub received. */
export interface StubCall {
  command: string
  args: string[]
  cwd?: string
}

/** An execFile stub that answers each call with what `answer` returns: stdout text, or an Error to fail. */
export function stubAnswering(answer: (call: StubCall) => string | StubError): ExecFileStub {
  return (...callArgs) => {
    const [command, args, opts] = callArgs as [string, string[], { cwd?: string } | undefined]
    const out = answer({ command, args, cwd: opts?.cwd })
    const cb = callArgs.at(-1) as ExecFileCallback
    if (out instanceof Error) return cb(out)
    return cb(null, { stdout: out, stderr: '' })
  }
}

/** An execFile stub answer that fails with `error`. */
export function stubFails(error: StubError): ExecFileStub {
  return (...args) => (args.at(-1) as ExecFileCallback)(error)
}

/** shell.exec answered by an execFile stub, which sees the cwd, env and limits it was given. */
function execOverStub(stub: ExecFileStub): Exec {
  return ((options: Parameters<Exec>[0] & { input?: string }) =>
    new Promise<ShellExecResult>((resolve) => {
      const { cwd, env, timeoutMs, maxBuffer, input } = options
      const stubOptions = { cwd, env, timeout: timeoutMs, maxBuffer, input }
      stub(options.command, options.args, stubOptions, resolve$)
      function resolve$(error: StubError | null, out?: { stdout?: string; stderr?: string }) {
        resolve(toResult(error, out))
      }
    })) as Exec
}

/** Binds git-integration's git runner to an execFile stub. */
export function bindShellToStub(stub: ExecFileStub): void {
  bindShell({ exec: execOverStub(stub) })
}

/** Binds the git runner to a function answering each command with stdout, or an Error. */
export function bindShellToAnswers(
  answer: (command: string, args: string[], options: { cwd: string }) => unknown
): void {
  bindShell({
    exec: (async (options: Parameters<Exec>[0]) => {
      const out = answer(options.command, options.args, { cwd: options.cwd })
      if (out instanceof Error) return toResult(out)
      return toResult(null, { stdout: typeof out === 'string' ? out : '' })
    }) as Exec,
  })
}

type PromisedStub = (...args: unknown[]) => Promise<{ stdout?: string; stderr?: string }>

/** shell.exec answered by a stub of promisified execFile, which resolves or rejects. */
export function execOverPromisedStub(stub: PromisedStub): Exec {
  return (async (options: Parameters<Exec>[0]) => {
    try {
      return toResult(null, await stub(options.command, options.args, { cwd: options.cwd }))
    } catch (error) {
      return toResult(error as StubError)
    }
  }) as Exec
}

/** The core's real api.github, running gh through a promisified execFile stub. */
export function githubOverPromisedStub(stub: PromisedStub): GithubAPI {
  const exec = execOverPromisedStub(stub)
  return createGithubApi((input) => exec({ ...input, command: 'gh' }))
}

/** The core's real api.github, running gh through an execFile stub. */
export function githubOverStub(stub: ExecFileStub): GithubAPI {
  return createGithubApi((input) => execOverStub(stub)({ ...input, command: 'gh' }))
}

/** Binds git-integration's git runner to real git processes. */
export function bindRealShell(env: NodeJS.ProcessEnv): void {
  bindShell({
    exec: ((options: Parameters<Exec>[0]) =>
      new Promise<ShellExecResult>((resolve) => {
        execFile(
          options.command,
          options.args,
          { cwd: options.cwd, env },
          (error, stdout, stderr) =>
            resolve(
              toResult(error ? Object.assign(error, { stdout, stderr }) : null, { stdout, stderr })
            )
        )
      })) as Exec,
  })
}
