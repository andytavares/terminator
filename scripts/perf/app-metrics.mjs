// Measures the built app (`npm run build` first): start-up milestones, memory
// per process after it settles, and terminal throughput.
//   node scripts/perf/app-metrics.mjs [--runs=5] [--settle-ms=9000] [--throughput]
//                                     [--electron-arg=<flag>]...
// Each run uses a throw-away profile. Memory comes from app.getAppMetrics()
// (https://www.electronjs.org/docs/latest/api/app#appgetappmetrics), which
// reports the same numbers on every platform.
import { _electron as electron } from 'playwright'
import { existsSync, mkdtempSync, rmSync } from 'node:fs'
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

// A fresh profile has no terminal: add a workspace and a branch, which opens one.
async function openTerminal(page, folder) {
  await page.click('.sidebar-header__add')
  await page.getByPlaceholder('My Workspace').fill('Perf')
  await page.getByPlaceholder('/path/to/folder').fill(folder)
  await page.click('.dialog__btn-primary')
  const header = page.locator('.repo-header').filter({ hasText: 'Perf' })
  await header.hover()
  await header.locator('.repo-header__action[aria-label="New branch in Perf"]').click()
  await page.getByPlaceholder('My branch').fill('perf')
  await page.click('.dialog__btn-primary')
  await page.locator('.branch-row').filter({ hasText: 'perf' }).last().click()
  await page.getByRole('textbox', { name: 'Terminal input' }).first().waitFor({ timeout: 30_000 })
}

// The shell creates a marker file when the output has been written, so the wait
// does not depend on how the terminal draws (DOM rows or WebGL).
async function terminalThroughput(page, profile) {
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
  return performance.now() - startedAt
}

async function measureOnce(settleMs, withThroughput) {
  const profile = mkdtempSync(join(tmpdir(), 'terminator-perf-'))
  const { app, page, startup } = await launch(profile)
  try {
    await page.waitForTimeout(settleMs)
    const memory = await memoryByProcessType(app)
    const cpuBefore = await cpuSecondsByProcessType(app)
    const throughputMs = withThroughput ? await terminalThroughput(page, profile) : null
    const cpuAfter = await cpuSecondsByProcessType(app)
    const throughputCpuSeconds = Object.fromEntries(
      Object.keys(cpuAfter).map((type) => [type, cpuAfter[type] - (cpuBefore[type] ?? 0)])
    )
    return { startup, memory, throughputMs, throughputCpuSeconds }
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
    throughputRunsMs:
      results[0].throughputMs === null ? null : results.map((r) => Math.round(r.throughputMs)),
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

const runs = Number(option('runs', '5'))
const settleMs = Number(option('settle-ms', '9000'))
const withThroughput = process.argv.includes('--throughput')
const results = []
for (let run = 0; run < runs; run++) results.push(await measureOnce(settleMs, withThroughput))
console.log(JSON.stringify(summarise(results), null, 2))
