import { z } from 'zod'
import { defineChannel, type ChannelSpec } from '@terminator/extension-sdk'
import { registerInvokeTable, noPayload } from './invoke-table.js'
import * as os from 'os'
import { readFile } from 'fs/promises'
import { runTextCommand } from '../shell/command-runner.js'
import type { PtyManager } from '../terminal/pty-manager.js'
import type { SystemMetrics, ProcessMetrics } from '../../shared/types/index.js'

// ─── CPU sampler ────────────────────────────────────────────────────────────

interface CpuSnapshot {
  idle: number
  total: number
}

function takeCpuSnapshot(): CpuSnapshot {
  return os.cpus().reduce(
    (acc, cpu) => {
      const times = cpu.times
      const total = (Object.values(times) as number[]).reduce((s, v) => s + v, 0)
      acc.idle += times.idle
      acc.total += total
      return acc
    },
    { idle: 0, total: 0 }
  )
}

// ─── Network sampler ─────────────────────────────────────────────────────────

/** Runs a sampler (netstat, ps) and resolves with its stdout, or rejects when it fails. Through
 * runTextCommand, so one still running as the app quits is stopped. */
async function runSampler(
  command: string,
  args: string[],
  options: { timeout: number }
): Promise<{ stdout: string }> {
  const input = { command, args, cwd: process.cwd(), timeoutMs: options.timeout }
  const result = await runTextCommand(input, process.env)
  if (result.exitCode !== 0) throw new Error(`${command} failed: ${result.stderr}`)
  return { stdout: result.stdout }
}

interface NetBytes {
  bytesIn: number
  bytesOut: number
}

interface NetSnapshot extends NetBytes {
  ts: number
}

function sumProcNetDev(raw: string): NetBytes {
  let bytesIn = 0
  let bytesOut = 0
  for (const line of raw.split('\n').slice(2)) {
    const parts = line.trim().split(/\s+/)
    const iface = parts[0]?.replace(':', '')
    if (!iface || iface === 'lo') continue
    bytesIn += parseInt(parts[1] ?? '0', 10) || 0
    bytesOut += parseInt(parts[9] ?? '0', 10) || 0
  }
  return { bytesIn, bytesOut }
}

// Columns: Name Mtu Network Address Ipkts Ierrs Ibytes Opkts Oerrs Obytes Drop
function sumNetstat(raw: string): NetBytes {
  let bytesIn = 0
  let bytesOut = 0
  for (const line of raw.split('\n').slice(1)) {
    const parts = line.trim().split(/\s+/)
    const iface = parts[0] ?? ''
    if (!iface || iface.startsWith('lo')) continue
    const ib = parseInt(parts[6] ?? '0', 10)
    const ob = parseInt(parts[9] ?? '0', 10)
    if (!isNaN(ib)) bytesIn += ib
    if (!isNaN(ob)) bytesOut += ob
  }
  return { bytesIn, bytesOut }
}

/** @internal */
export async function readNetBytes(): Promise<NetBytes> {
  try {
    if (process.platform === 'linux') {
      return sumProcNetDev(await readFile('/proc/net/dev', 'utf-8'))
    }
    const { stdout } = await runSampler('netstat', ['-ib'], { timeout: 2000 })
    return sumNetstat(stdout.toString())
  } catch {
    return { bytesIn: 0, bytesOut: 0 }
  }
}

// ─── Background sampler state ────────────────────────────────────────────────

// The sampler runs only while the renderer polls metrics:system, which it does
// only while a metrics view is showing. It stops once polls have been absent
// this long; the renderer polls every 2 s.
const SAMPLER_IDLE_MS = 5000

let prevCpu: CpuSnapshot = { idle: 0, total: 0 }
let latestCpuPercent = 0

let prevNet: NetSnapshot | null = null
let latestNetIn = 0
let latestNetOut = 0

let samplerTimer: ReturnType<typeof setInterval> | null = null
let lastRequestedAt = 0
let networkSampleInFlight = false

function sampleCpu(): void {
  const curr = takeCpuSnapshot()
  const idleDelta = curr.idle - prevCpu.idle
  const totalDelta = curr.total - prevCpu.total
  latestCpuPercent = totalDelta > 0 ? 100 * (1 - idleDelta / totalDelta) : 0
  prevCpu = curr
}

async function sampleNetwork(): Promise<void> {
  if (networkSampleInFlight) return
  networkSampleInFlight = true
  try {
    const net = await readNetBytes()
    const now = Date.now()
    if (prevNet !== null) {
      const elapsed = (now - prevNet.ts) / 1000
      if (elapsed > 0) {
        latestNetIn = Math.max(0, (net.bytesIn - prevNet.bytesIn) / elapsed)
        latestNetOut = Math.max(0, (net.bytesOut - prevNet.bytesOut) / elapsed)
      }
    }
    prevNet = { ts: now, ...net }
  } finally {
    networkSampleInFlight = false
  }
}

function tick(): void {
  if (samplerTimer !== null && Date.now() - lastRequestedAt > SAMPLER_IDLE_MS) {
    clearInterval(samplerTimer)
    samplerTimer = null
    return
  }
  sampleCpu()
  void sampleNetwork()
}

/** Called on every metrics:system poll: keeps the sampler running, starting it if it is stopped. */
function keepSamplerRunning(): void {
  lastRequestedAt = Date.now()
  if (samplerTimer !== null) return
  // Rates are measured between samples, so a restart must not span the idle gap.
  prevCpu = takeCpuSnapshot()
  prevNet = null
  latestCpuPercent = 0
  latestNetIn = 0
  latestNetOut = 0
  void sampleNetwork()
  samplerTimer = setInterval(tick, 1000)
  samplerTimer.unref()
}

// ─── ps-based process metrics ────────────────────────────────────────────────

/** @internal */
export async function queryProcessMetrics(pids: number[]): Promise<ProcessMetrics[]> {
  if (pids.length === 0) return []
  const columns =
    process.platform === 'linux'
      ? ['-o', 'pid,%cpu,rss', '--no-headers']
      : ['-o', 'pid=,%cpu=,rss=']
  try {
    const { stdout } = await runSampler('ps', ['-p', pids.join(','), ...columns], {
      timeout: 3000,
    })
    return parsePsRows(stdout)
  } catch {
    return []
  }
}

function parsePsRows(raw: string): ProcessMetrics[] {
  const results: ProcessMetrics[] = []
  for (const line of raw.split('\n')) {
    const parts = line.trim().split(/\s+/)
    if (parts.length < 3) continue
    const pid = parseInt(parts[0], 10)
    const cpu = parseFloat(parts[1])
    const rssKb = parseInt(parts[2], 10)
    if (!isNaN(pid) && !isNaN(cpu) && !isNaN(rssKb)) {
      results.push({ pid, cpuPercent: cpu, rssBytes: rssKb * 1024 })
    }
  }
  return results
}

// ─── IPC registration ────────────────────────────────────────────────────────

const machineChannels: ChannelSpec[] = [
  defineChannel({
    channel: 'metrics:system',
    schema: noPayload,
    invalid: { error: 'VALIDATION_ERROR' },
    run: (): { data: SystemMetrics } => {
      keepSamplerRunning()
      return {
        data: {
          cpuPercent: Math.min(100, Math.max(0, latestCpuPercent)),
          memUsedBytes: os.totalmem() - os.freemem(),
          memTotalBytes: os.totalmem(),
          netInBytesPerSec: latestNetIn,
          netOutBytesPerSec: latestNetOut,
        },
      }
    },
  }),
  defineChannel({
    channel: 'metrics:processes',
    schema: z.object({ pids: z.array(z.number().int()).optional() }),
    invalid: { data: [] },
    run: async ({ pids }): Promise<{ data: ProcessMetrics[] }> => ({
      data: await queryProcessMetrics(pids ?? []),
    }),
  }),
]

/** The process id behind each live terminal session asked about. */
function sessionPidsChannel(ptyManager: PtyManager): ChannelSpec {
  return defineChannel({
    channel: 'metrics:pids',
    schema: z.object({ sessionIds: z.array(z.string()).optional() }),
    invalid: { data: [] },
    run: ({ sessionIds }) => {
      const data = (sessionIds ?? [])
        .map((sessionId) => ({ sessionId, pid: ptyManager.getPid(sessionId) }))
        .filter((r): r is { sessionId: string; pid: number } => r.pid !== undefined)
      return { data }
    },
  })
}

export function registerMetricsHandlers(ptyManager: PtyManager): void {
  registerInvokeTable([...machineChannels, sessionPidsChannel(ptyManager)])
}
