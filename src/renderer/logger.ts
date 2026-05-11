import { useLogStore, type LogLevel } from './stores/log.store'

function ship(level: LogLevel, namespace: string, message: string): void {
  useLogStore.getState().addEntry(level, `[${namespace}] ${message}`)
  try {
    window.electronAPI.logger.write(level, namespace, message)
  } catch {
    // IPC not available (e.g. tests or storybook) — silent
  }
}

export interface RendererLogger {
  debug(message: string, ...meta: unknown[]): void
  info(message: string, ...meta: unknown[]): void
  warn(message: string, ...meta: unknown[]): void
  error(message: string, ...meta: unknown[]): void
}

function fmt(message: string, meta: unknown[]): string {
  if (meta.length === 0) return message
  return (
    message +
    ' ' +
    meta.map((m) => (typeof m === 'object' ? JSON.stringify(m) : String(m))).join(' ')
  )
}

export function makeRendererLogger(namespace: string): RendererLogger {
  return {
    debug: (msg, ...meta) => ship('log', namespace, fmt(msg, meta)),
    info: (msg, ...meta) => ship('info', namespace, fmt(msg, meta)),
    warn: (msg, ...meta) => ship('warn', namespace, fmt(msg, meta)),
    error: (msg, ...meta) => ship('error', namespace, fmt(msg, meta)),
  }
}

/**
 * Call once at app startup. Wraps console.* so every call in the renderer
 * is captured in the log store and shipped to the main-process log file.
 */
export function installLogInterceptor(): void {
  const wrap =
    (level: LogLevel, original: (...args: unknown[]) => void) =>
    (...args: unknown[]): void => {
      original.apply(console, args)
      const message = args
        .map((a) => (typeof a === 'object' ? JSON.stringify(a) : String(a)))
        .join(' ')
      ship(level, 'renderer', message)
    }

  console.log = wrap('log', console.log.bind(console))
  console.info = wrap('info', console.info.bind(console))
  console.warn = wrap('warn', console.warn.bind(console))
  console.error = wrap('error', console.error.bind(console))
}
