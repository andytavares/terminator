#!/usr/bin/env node
// node scripts/smoke-start.mjs dev | preview | exec <app>: starts the app on a fresh profile,
// checks it came up whole (App ready, every extension activated, no error) and quits it.
// What it checks and why: docs/CONTRIBUTING.md, "Check that the app starts".

import { execFileSync, spawn } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, readdirSync } from 'node:fs'
import { tmpdir, userInfo } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const STARTUP_DEADLINE_MS = 300_000
// Errors that come just after the last extension activates still count.
const SETTLE_MS = 5_000
const EXIT_DEADLINE_MS = 15_000

/** The id in each extensions/<name>/manifest.json. */
export function bundledExtensionIds(extensionsDirectory) {
  return readdirSync(extensionsDirectory, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => join(extensionsDirectory, entry.name, 'manifest.json'))
    .filter((manifest) => existsSync(manifest))
    .map((manifest) => JSON.parse(readFileSync(manifest, 'utf8')).id)
    .sort()
}

const ERROR_PATTERNS = [
  // A main-process log line at ERROR level (src/main/logger.ts).
  /^\S+ ERROR \[.*$/gm,
  // Electron's report of an uncaught exception in main.
  /^.*(Uncaught Exception|A JavaScript error occurred in the main process).*$/gm,
  // A renderer's uncaught exception or rejection, as Chromium logs it.
  /^.*CONSOLE.*"Uncaught.*$/gm,
]

/** Every line of `output` that reports an error. */
export function errorLines(output) {
  return ERROR_PATTERNS.flatMap((pattern) => output.match(pattern) ?? [])
}

/** How far startup has got: whether main is ready and which extensions are not yet active. */
export function startupProgress(output, extensionIds) {
  return {
    ready: /\[main\] App ready\b/.test(output),
    inactive: extensionIds.filter((id) => !output.includes(`Extension ${id} activated`)),
  }
}

/** Why the run failed, one line each; empty when it passed. */
export function startupProblems(output, extensionIds) {
  const { ready, inactive } = startupProgress(output, extensionIds)
  return [
    ...(ready ? [] : ['the main process never logged "App ready"']),
    ...inactive.map((id) => `extension ${id} never logged that it activated`),
    ...errorLines(output).map((line) => `error: ${line.trim()}`),
  ]
}

/** The main log file: on macOS app.getPath('logs') is ~/Library/Logs/<app name>
 * (https://www.electronjs.org/docs/latest/api/app#appsetapplogspathpath), under the account's
 * home: Electron does not read HOME, so the app's own HOME does not move it. */
export function mainLogPath({ appName }) {
  return join(userInfo().homedir, 'Library', 'Logs', appName, 'terminator.log')
}

/** The command that starts the app for `mode`: electron-vite, or a packaged executable.
 * @param {{ mode: string, userDataDirectory: string, executable?: string }} options */
export function startCommand({ mode, userDataDirectory, executable }) {
  const appArguments = [`--user-data-dir=${userDataDirectory}`]
  if (mode === 'exec') return [executable, appArguments]
  // `--` for the arguments electron-vite hands Electron (https://electron-vite.org/guide/cli).
  return ['npm', ['run', mode, '--', '--', ...appArguments]]
}

function readFrom(path, offset) {
  if (!existsSync(path)) return ''
  return readFileSync(path).subarray(offset).toString('utf8')
}

function sizeOf(path) {
  return existsSync(path) ? readFileSync(path).length : 0
}

/** The app's environment: logging on, in the background (src/main/background-mode.ts), so a
 * smoke run neither shows a window nor takes focus, and in a fresh `home`: the app writes hooks
 * into ~/.claude/settings.json, which must be neither the developer's nor different from CI's. */
export function launchEnvironment(env, home) {
  return { ...env, HOME: home, ELECTRON_ENABLE_LOGGING: '1', TERMINATOR_RUN_IN_BACKGROUND: '1' }
}

function launch([command, args], home) {
  const child = spawn(command, args, {
    cwd: REPO_ROOT,
    detached: true,
    env: launchEnvironment(process.env, home),
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  const run = { child, output: '', exitCode: undefined }
  for (const stream of [child.stdout, child.stderr]) {
    stream.on('data', (chunk) => {
      run.output += chunk
      process.stdout.write(chunk)
    })
  }
  child.on('exit', (code, signal) => (run.exitCode = code ?? signal))
  return run
}

const waitMs = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

/** Waits until every extension is active, the app exits, or the deadline passes. */
async function awaitStartup(run, observed, extensionIds) {
  const deadline = Date.now() + STARTUP_DEADLINE_MS
  while (Date.now() < deadline && run.exitCode === undefined) {
    const { ready, inactive } = startupProgress(observed(), extensionIds)
    if (ready && inactive.length === 0) return waitMs(SETTLE_MS)
    await waitMs(500)
  }
}

/** The Electron main process under `rootPid` in a `ps -o pid=,ppid=,args=` table: the one
 * running `binary` that is not one of Chromium's helpers, which all carry --type=. */
export function electronMainPid(processTable, rootPid, binary) {
  const rows = processTable
    .split('\n')
    .map((line) => line.trim().match(/^(\d+)\s+(\d+)\s+(.*)$/))
    .filter(Boolean)
    .map(([, pid, parent, args]) => ({ pid: Number(pid), parent: Number(parent), args }))
  // Repeated until nothing joins: once pids wrap, a child can sort before its parent.
  const tree = new Set([rootPid])
  let size = 0
  while (size !== tree.size) {
    size = tree.size
    for (const row of rows) if (tree.has(row.parent)) tree.add(row.pid)
  }
  const main = rows.find(
    (row) => tree.has(row.pid) && row.args.startsWith(binary) && !row.args.includes('--type=')
  )
  return main?.pid
}

function electronBinary(executable) {
  if (executable) return executable
  const electron = join(REPO_ROOT, 'node_modules', 'electron')
  return join(electron, 'dist', readFileSync(join(electron, 'path.txt'), 'utf8').trim())
}

/** Asks Electron's main process to quit, as the OS does at logout, and waits for the
 * command to exit by itself: npm and electron-vite exit with Electron's code. */
async function quit(run, executable) {
  const table = execFileSync('ps', ['-A', '-o', 'pid=,ppid=,args='], { encoding: 'utf8' })
  const pid = electronMainPid(table, run.child.pid, electronBinary(executable))
  if (pid) process.kill(pid, 'SIGTERM')
  const deadline = Date.now() + EXIT_DEADLINE_MS
  while (run.exitCode === undefined && Date.now() < deadline) await waitMs(200)
  if (run.exitCode !== undefined) return run.exitCode
  process.kill(-run.child.pid, 'SIGKILL')
  return pid ? `still running 15s after SIGTERM to ${pid}` : 'no Electron main process found'
}

function appName() {
  const { productName, name } = JSON.parse(readFileSync(join(REPO_ROOT, 'package.json'), 'utf8'))
  return productName ?? name
}

async function main([mode, executable]) {
  if (!['dev', 'preview', 'exec'].includes(mode) || (mode === 'exec') !== Boolean(executable)) {
    throw new Error('usage: smoke-start.mjs dev | preview | exec <executable>')
  }
  const userDataDirectory = mkdtempSync(join(tmpdir(), 'terminator-smoke-'))
  const home = mkdtempSync(join(tmpdir(), 'terminator-smoke-home-'))
  const logPath = mainLogPath({ appName: appName() })
  const logOffset = sizeOf(logPath)
  const extensionIds = bundledExtensionIds(join(REPO_ROOT, 'extensions'))
  const run = launch(startCommand({ mode, userDataDirectory, executable }), home)
  const outputSoFar = () => `${readFrom(logPath, logOffset)}\n${run.output}`

  await awaitStartup(run, outputSoFar, extensionIds)
  const exitedEarly = run.exitCode !== undefined
  const exitOnQuit = exitedEarly ? run.exitCode : await quit(run, executable)
  const problems = [
    ...(exitedEarly ? [`the app exited by itself (${run.exitCode}) before startup finished`] : []),
    ...(exitedEarly || exitOnQuit === 0 ? [] : [`the app did not quit cleanly: ${exitOnQuit}`]),
    ...startupProblems(outputSoFar(), extensionIds),
  ]
  return { problems, extensionIds, mainLog: readFrom(logPath, logOffset) }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const { problems, extensionIds, mainLog } = await main(process.argv.slice(2))
  console.log(`\n--- main log ---\n${mainLog}`)
  if (problems.length > 0) {
    console.error(`\nSmoke start FAILED:\n${problems.map((p) => `  - ${p}`).join('\n')}`)
    process.exit(1)
  }
  console.log(`\nSmoke start passed: App ready, ${extensionIds.join(', ')} activated, no errors.`)
}
