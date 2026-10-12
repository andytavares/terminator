// Measures the built app (`npm run build` first): start-up milestones, memory
// per process after it settles, and terminal throughput.
//   node scripts/perf/app-metrics.mjs [--runs=5] [--settle-ms=9000] [--throughput]
//                                     [--electron-arg=<flag>]... [--extensions=each]
// Each run uses a throw-away profile. Memory comes from app.getAppMetrics()
// (https://www.electronjs.org/docs/latest/api/app#appgetappmetrics), which
// reports the same numbers on every platform.
//
// --extensions=each measures the extension host instead: the same runs with no
// extension enabled, with a probe that loads nothing (the host's own cost), with
// each bundled extension enabled alone beside the probe, and with all of them.
// The probe also reports process.memoryUsage() from inside the host.
import { _electron as electron } from 'playwright'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const THROUGHPUT_BYTES = 50 * 1024 * 1024

function option(name, fallback) {
  const hit = process.argv.find((arg) => arg.startsWith(`--${name}=`))
  return hit ? hit.slice(name.length + 3) : fallback
}

function electronArgs() {
  return process.argv
    .filter((arg) => arg.startsWith('--electron-arg='))
    .map((arg) => arg.slice('--electron-arg='.length))
}

function median(values) {
  const sorted = [...values].sort((a, b) => a - b)
  return sorted[Math.floor(sorted.length / 2)]
}

// The utilityProcess serviceName src/main/extensions/host/host-process.ts gives the host.
const HOST_NAME = 'Extension Host'

// The host's working set and peak in MB, or null when no host is running.
async function hostMemory(app) {
  const metrics = await app.evaluate(({ app: electronApp }) => electronApp.getAppMetrics())
  const host = metrics.find((metric) => metric.type === 'Utility' && metric.name === HOST_NAME)
  if (!host) return null
  return {
    workingSetMB: host.memory.workingSetSize / 1024,
    peakWorkingSetMB: host.memory.peakWorkingSetSize / 1024,
  }
}

async function launch(profile) {
  const launchedAt = performance.now()
  const app = await electron.launch({
    args: ['.', `--user-data-dir=${profile}`, ...electronArgs()],
    env: { ...process.env, NODE_ENV: 'test' },
  })
  const attached = performance.now() - launchedAt
  const page = await app.firstWindow()
  const windowAt = performance.now() - launchedAt
  await page.waitForLoadState('domcontentloaded')
  const domReady = performance.now() - launchedAt
  await page.waitForSelector('.unified-sidebar')
  const sidebar = performance.now() - launchedAt
  return { app, page, startup: { attached, windowAt, domReady, sidebar } }
}

async function memoryByProcessType(app) {
  const metrics = await app.evaluate(({ app: electronApp }) => electronApp.getAppMetrics())
  const totals = {}
  for (const metric of metrics) {
    const megabytes = metric.memory.workingSetSize / 1024
    totals[metric.type] = (totals[metric.type] ?? 0) + megabytes
  }
  return totals
}

// CPU seconds used so far, per process type. Unlike wall time it does not grow
// when other work shares the machine, so before/after comparisons can use it.
async function cpuSecondsByProcessType(app) {
  const metrics = await app.evaluate(({ app: electronApp }) => electronApp.getAppMetrics())
  const totals = {}
  for (const metric of metrics) {
    totals[metric.type] = (totals[metric.type] ?? 0) + metric.cpu.cumulativeCPUUsage
  }
  return totals
}

// The dialogs' submit button: the design system's on this branch, the old class on
// a build from before it, so one script measures both.
const SUBMIT = '.tmui-dialog__actions .tmui-button--primary, .dialog__btn-primary'

// A fresh profile has no terminal: add a workspace and a branch, which opens one.
async function openTerminal(page, folder) {
  await page.click('.sidebar-header__add')
  await page.getByPlaceholder('My Workspace').fill('Perf')
  await page.getByPlaceholder('/path/to/folder').fill(folder)
  await page.click(SUBMIT)
  const header = page.locator('.repo-header').filter({ hasText: 'Perf' })
  await header.hover()
  await header.locator('.repo-header__action[aria-label="New branch in Perf"]').click()
  await page.getByPlaceholder('My branch').fill('perf')
  await page.click(SUBMIT)
  await page.locator('.branch-row').filter({ hasText: 'perf' }).last().click()
  await page.getByRole('textbox', { name: 'Terminal input' }).first().waitFor({ timeout: 30_000 })
}

const IDLE_POLL_MS = 1000

// Waits until the app's processes have stopped using CPU: the renderer is still
// parsing and drawing after the shell is done writing.
async function waitUntilIdle(app) {
  const total = async () =>
    Object.values(await cpuSecondsByProcessType(app)).reduce((sum, seconds) => sum + seconds, 0)
  let last = await total()
  for (;;) {
    await new Promise((resolve) => setTimeout(resolve, IDLE_POLL_MS))
    const now = await total()
    if (now - last < 0.1) return
    last = now
  }
}

// The shell creates a marker file when it has written the output, so the wait
// does not depend on how the terminal draws (DOM rows or WebGL). producedMs is
// when the shell finished; renderedMs is when the app went idle after it.
async function terminalThroughput(page, app, profile) {
  await openTerminal(page, profile)
  await page.getByRole('textbox', { name: 'Terminal input' }).first().focus()
  const marker = join(profile, 'perf-done')
  const command = `head -c ${THROUGHPUT_BYTES} /dev/zero | tr '\\0' x; echo; touch ${marker}\r`
  const startedAt = performance.now()
  await page.keyboard.type(command)
  while (!existsSync(marker)) {
    if (performance.now() - startedAt > 300_000) throw new Error('throughput run timed out')
    await new Promise((resolve) => setTimeout(resolve, 50))
  }
  const producedMs = performance.now() - startedAt
  await waitUntilIdle(app)
  return { producedMs, renderedMs: performance.now() - startedAt - IDLE_POLL_MS }
}

async function measureOnce(settleMs, withThroughput) {
  const profile = mkdtempSync(join(tmpdir(), 'terminator-perf-'))
  const { app, page, startup } = await launch(profile)
  try {
    await page.waitForTimeout(settleMs)
    const memory = await memoryByProcessType(app)
    const cpuBefore = await cpuSecondsByProcessType(app)
    const throughput = withThroughput ? await terminalThroughput(page, app, profile) : null
    const throughputMs = throughput?.producedMs ?? null
    const renderedMs = throughput?.renderedMs ?? null
    const cpuAfter = await cpuSecondsByProcessType(app)
    const memoryAfterThroughput = withThroughput ? await memoryByProcessType(app) : null
    const throughputCpuSeconds = Object.fromEntries(
      Object.keys(cpuAfter).map((type) => [type, cpuAfter[type] - (cpuBefore[type] ?? 0)])
    )
    return {
      startup,
      memory,
      throughputMs,
      renderedMs,
      throughputCpuSeconds,
      memoryAfterThroughput,
    }
  } finally {
    await app.close()
    rmSync(profile, { recursive: true, force: true })
  }
}

function summarise(results) {
  const pick = (read) => Math.round(median(results.map(read)))
  const types = Object.keys(results[0].memory)
  return {
    runs: results.length,
    startupMs: Object.fromEntries(
      Object.keys(results[0].startup).map((key) => [key, pick((r) => r.startup[key])])
    ),
    memoryMB: Object.fromEntries(types.map((type) => [type, pick((r) => r.memory[type] ?? 0)])),
    throughputMs: results[0].throughputMs === null ? null : pick((r) => r.throughputMs),
    renderedMs: results[0].renderedMs === null ? null : pick((r) => r.renderedMs),
    throughputRunsMs:
      results[0].throughputMs === null ? null : results.map((r) => Math.round(r.throughputMs)),
    memoryAfterThroughputMB:
      results[0].throughputMs === null
        ? null
        : Object.fromEntries(
            types.map((type) => [type, pick((r) => r.memoryAfterThroughput[type] ?? 0)])
          ),
    throughputCpuSeconds:
      results[0].throughputMs === null
        ? null
        : Object.fromEntries(
            Object.keys(results[0].throughputCpuSeconds).map((type) => [
              type,
              Number(median(results.map((r) => r.throughputCpuSeconds[type] ?? 0)).toFixed(2)),
            ])
          ),
  }
}

// The extension records a fresh profile ends up with: the app writes them on its first start.
async function bundledRecords() {
  const profile = mkdtempSync(join(tmpdir(), 'terminator-perf-seed-'))
  try {
    const { app } = await launch(profile)
    await app.close()
    return JSON.parse(readFileSync(join(profile, 'extensions.json'), 'utf8')).extensions
  } finally {
    rmSync(profile, { recursive: true, force: true })
  }
}

const PROBE_ID = 'perf.probe'

// An extension that loads nothing and writes the host's process.memoryUsage() beside
// itself every half second, so the last one is from when the app was sampled. Alone it
// measures the host's own cost.
const PROBE_SOURCE = `const { writeFileSync } = require('node:fs')
const { join } = require('node:path')
const write = () => writeFileSync(join(__dirname, 'memory.json'), JSON.stringify(process.memoryUsage()))
exports.activate = () => {
  write()
  setInterval(write, 500)
}
`

function probeRecord(template, directory) {
  const manifest = {
    id: PROBE_ID,
    name: 'Probe',
    version: '1.0.0',
    description: 'Reports the extension host memory',
    minAppVersion: '0.0.1',
  }
  writeFileSync(join(directory, 'manifest.json'), JSON.stringify({ ...manifest, main: 'main.js' }))
  writeFileSync(join(directory, 'main.js'), PROBE_SOURCE)
  return {
    ...template,
    ...manifest,
    entryPoint: join(directory, 'main.js'),
    status: 'enabled',
    directoryPath: directory,
    rendererRelPath: undefined,
    rendererUrl: undefined,
    contributes: undefined,
  }
}

// Every bundled record, enabled only when `enabled(record)` says so.
function recordsEnabling(records, enabled) {
  return records.map((record) => ({ ...record, status: enabled(record) ? 'enabled' : 'disabled' }))
}

// What the probe last wrote, in MB, then removed so the next run cannot read it. Null when
// the probe had not activated yet.
function insideHost(probeDirectory) {
  const file = join(probeDirectory, 'memory.json')
  if (!existsSync(file)) return null
  const usage = JSON.parse(readFileSync(file, 'utf8'))
  rmSync(file)
  return Object.fromEntries(Object.entries(usage).map(([key, bytes]) => [key, bytes / 1024 / 1024]))
}

async function measureHostOnce(records, settleMs) {
  const profile = mkdtempSync(join(tmpdir(), 'terminator-perf-'))
  writeFileSync(join(profile, 'extensions.json'), JSON.stringify({ extensions: records }))
  const { app, page } = await launch(profile)
  try {
    await page.waitForTimeout(settleMs)
    return { host: await hostMemory(app), memory: await memoryByProcessType(app) }
  } finally {
    await app.close()
    rmSync(profile, { recursive: true, force: true })
  }
}

// One run: the app's numbers, then what the probe wrote, read once the app has closed.
async function measureHostRun(records, settleMs, probeDirectory) {
  const measured = await measureHostOnce(records, settleMs)
  return { ...measured, inside: insideHost(probeDirectory) }
}

function summariseHost(results) {
  const pick = (read) => Math.round(median(results.map(read)))
  const probed = results.filter((r) => r.inside !== null)
  const pickProbed = (key) => Number(median(probed.map((r) => r.inside[key])).toFixed(1))
  return {
    runs: results.length,
    hostMB: results[0].host && {
      workingSet: pick((r) => r.host.workingSetMB),
      peakWorkingSet: pick((r) => r.host.peakWorkingSetMB),
    },
    probedRuns: probed.length,
    insideHostMB:
      probed.length === 0
        ? null
        : Object.fromEntries(Object.keys(probed[0].inside).map((key) => [key, pickProbed(key)])),
    totalMB: pick((r) => Object.values(r.memory).reduce((sum, mb) => sum + mb, 0)),
  }
}

// --extensions=each: no extension (no host), the probe alone, each bundled one with the probe, all.
function hostScenarios(records, probe) {
  const only = (id) => [...recordsEnabling(records, (record) => record.id === id), probe]
  return [
    { name: 'none', records: recordsEnabling(records, () => false) },
    { name: PROBE_ID, records: only(null) },
    ...records.map((record) => ({ name: record.id, records: only(record.id) })),
    { name: 'all', records: [...recordsEnabling(records, () => true), probe] },
  ]
}

async function measureEachExtension(runs, settleMs) {
  const probeDirectory = mkdtempSync(join(tmpdir(), 'terminator-perf-probe-'))
  try {
    const records = await bundledRecords()
    const probe = probeRecord(records[0], probeDirectory)
    const summary = {}
    for (const scenario of hostScenarios(records, probe)) {
      const results = []
      for (let run = 0; run < runs; run++)
        results.push(await measureHostRun(scenario.records, settleMs, probeDirectory))
      summary[scenario.name] = summariseHost(results)
    }
    return summary
  } finally {
    rmSync(probeDirectory, { recursive: true, force: true })
  }
}

async function measureApp(runs, settleMs) {
  const withThroughput = process.argv.includes('--throughput')
  const results = []
  for (let run = 0; run < runs; run++) results.push(await measureOnce(settleMs, withThroughput))
  return summarise(results)
}

const runs = Number(option('runs', '5'))
const settleMs = Number(option('settle-ms', '9000'))
const summary =
  option('extensions', '') === 'each'
    ? await measureEachExtension(runs, settleMs)
    : await measureApp(runs, settleMs)
console.log(JSON.stringify(summary, null, 2))
