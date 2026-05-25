import { ipcMain } from 'electron'
import { execSync } from 'child_process'
import * as os from 'os'
import { readFileSync } from 'fs'
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

interface NetSnapshot {
  ts: number
  bytesIn: number
  bytesOut: number
}

function readNetBytes(): { bytesIn: number; bytesOut: number } {
  try {
    if (process.platform === 'linux') {
      const raw = readFileSync('/proc/net/dev', 'utf-8')
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
    // macOS — parse netstat -ib
    const raw = execSync('netstat -ib', { timeout: 2000 }).toString()
    const lines = raw.split('\n').slice(1) // skip header
    let bytesIn = 0
    let bytesOut = 0
    for (const line of lines) {
      const parts = line.trim().split(/\s+/)
      const iface = parts[0] ?? ''
      if (!iface || iface.startsWith('lo')) continue
      // Columns: Name Mtu Network Address Ipkts Ierrs Ibytes Opkts Oerrs Obytes Drop
      const ib = parseInt(parts[6] ?? '0', 10)
      const ob = parseInt(parts[9] ?? '0', 10)
      if (!isNaN(ib)) bytesIn += ib
      if (!isNaN(ob)) bytesOut += ob
    }
    return { bytesIn, bytesOut }
  } catch {
    return { bytesIn: 0, bytesOut: 0 }
  }
}

// ─── Background sampler state ────────────────────────────────────────────────

let prevCpu: CpuSnapshot = takeCpuSnapshot()
let latestCpuPercent = 0

let prevNet: NetSnapshot = { ts: Date.now(), ...readNetBytes() }
let latestNetIn = 0
let latestNetOut = 0

function tick(): void {
  // CPU
  const curr = takeCpuSnapshot()
  const idleDelta = curr.idle - prevCpu.idle
  const totalDelta = curr.total - prevCpu.total
  latestCpuPercent = totalDelta > 0 ? 100 * (1 - idleDelta / totalDelta) : 0
  prevCpu = curr

  // Network
  const net = readNetBytes()
  const now = Date.now()
  const elapsed = (now - prevNet.ts) / 1000
  if (elapsed > 0) {
    latestNetIn = Math.max(0, (net.bytesIn - prevNet.bytesIn) / elapsed)
    latestNetOut = Math.max(0, (net.bytesOut - prevNet.bytesOut) / elapsed)
  }
  prevNet = { ts: now, ...net }
}

function startSampler(): void {
  setInterval(tick, 1000).unref()
}

// ─── ps-based process metrics ────────────────────────────────────────────────

function queryProcessMetrics(pids: number[]): ProcessMetrics[] {
  if (pids.length === 0) return []
  try {
    const pidArg = pids.join(',')
    const flags =
      process.platform === 'linux'
        ? `-p ${pidArg} -o pid,%cpu,rss --no-headers`
        : `-p ${pidArg} -o pid=,%cpu=,rss=`
    const raw = execSync(`ps ${flags}`, { timeout: 3000 }).toString()
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
  } catch {
    return []
  }
}

// ─── IPC registration ────────────────────────────────────────────────────────

export function registerMetricsHandlers(ptyManager: PtyManager): void {
  startSampler()

  ipcMain.handle('metrics:system', (): { data: SystemMetrics } => ({
    data: {
      cpuPercent: Math.min(100, Math.max(0, latestCpuPercent)),
      memUsedBytes: os.totalmem() - os.freemem(),
      memTotalBytes: os.totalmem(),
      netInBytesPerSec: latestNetIn,
      netOutBytesPerSec: latestNetOut,
    },
  }))

  ipcMain.handle(
    'metrics:processes',
    (_event, payload: { pids?: number[] }): { data: ProcessMetrics[] } => ({
      data: queryProcessMetrics(payload?.pids ?? []),
    })
  )

  ipcMain.handle(
    'metrics:pids',
    (
      _event,
      payload: { sessionIds?: string[] }
    ): { data: Array<{ sessionId: string; pid: number }> } => {
      const ids = payload?.sessionIds ?? []
      const data = ids
        .map((sessionId) => ({ sessionId, pid: ptyManager.getPid(sessionId) }))
        .filter((r): r is { sessionId: string; pid: number } => r.pid !== undefined)
      return { data }
    }
  )
}
