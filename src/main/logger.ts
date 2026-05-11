import { app } from 'electron'
import { createWriteStream, existsSync, renameSync, statSync, WriteStream } from 'fs'
import { join } from 'path'

export type LogLevel = 'debug' | 'info' | 'warn' | 'error'

const MAX_BYTES = 5 * 1024 * 1024 // 5 MB — rotate at this size

let stream: WriteStream | null = null
let logPath = ''

function getStream(): WriteStream {
  if (stream) return stream
  const dir = app.getPath('logs')
  logPath = join(dir, 'terminator.log')
  rotatIfNeeded(logPath)
  stream = createWriteStream(logPath, { flags: 'a' })
  return stream
}

function rotatIfNeeded(path: string): void {
  if (!existsSync(path)) return
  try {
    if (statSync(path).size > MAX_BYTES) {
      renameSync(path, path.replace('.log', '.old.log'))
    }
  } catch {
    // Ignore rotation errors — log will still open
  }
}

function write(level: LogLevel, namespace: string, message: string): void {
  const ts = new Date().toISOString()
  const padded = level.toUpperCase().padEnd(5)
  const line = `${ts} ${padded} [${namespace}] ${message}\n`
  try {
    getStream().write(line)
  } catch {
    // File logging failed — don't crash the app
  }
  // Mirror to terminal in dev
  if (process.env.NODE_ENV === 'development') {
    const fn =
      level === 'error'
        ? process.stderr.write.bind(process.stderr)
        : process.stdout.write.bind(process.stdout)
    fn(line)
  }
}

export interface NamespacedLogger {
  debug(message: string, ...meta: unknown[]): void
  info(message: string, ...meta: unknown[]): void
  warn(message: string, ...meta: unknown[]): void
  error(message: string, ...meta: unknown[]): void
}

function format(message: string, meta: unknown[]): string {
  if (meta.length === 0) return message
  const extra = meta.map((m) => (typeof m === 'object' ? JSON.stringify(m) : String(m))).join(' ')
  return `${message} ${extra}`
}

export function makeLogger(namespace: string): NamespacedLogger {
  return {
    debug: (msg, ...meta) => write('debug', namespace, format(msg, meta)),
    info: (msg, ...meta) => write('info', namespace, format(msg, meta)),
    warn: (msg, ...meta) => write('warn', namespace, format(msg, meta)),
    error: (msg, ...meta) => write('error', namespace, format(msg, meta)),
  }
}

export function writeFromRenderer(level: LogLevel, namespace: string, message: string): void {
  write(level, namespace, message)
}

export function getLogPath(): string {
  getStream()
  return logPath
}

export const logger = {
  debug: (msg: string, ...meta: unknown[]) => write('debug', 'main', format(msg, meta)),
  info: (msg: string, ...meta: unknown[]) => write('info', 'main', format(msg, meta)),
  warn: (msg: string, ...meta: unknown[]) => write('warn', 'main', format(msg, meta)),
  error: (msg: string, ...meta: unknown[]) => write('error', 'main', format(msg, meta)),
}
