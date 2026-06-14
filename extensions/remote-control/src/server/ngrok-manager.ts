import { spawn, execSync, type ChildProcess } from 'child_process'
import { networkInterfaces } from 'os'

// Packaged Electron apps launch without the user's shell, so Homebrew paths are absent.
const EXTRA_PATH = ['/opt/homebrew/bin', '/usr/local/bin', '/usr/bin', '/bin'].join(':')
const EXTENDED_ENV = { ...process.env, PATH: `${EXTRA_PATH}:${process.env.PATH ?? ''}` }

const POLL_INTERVAL_MS = 500
const MAX_POLLS = 60

export function generateCaddyfile(port: number): string {
  const ifaces = networkInterfaces()
  let hostname = 'localhost'
  for (const iface of Object.values(ifaces)) {
    for (const addr of iface ?? []) {
      if ((addr.family === 'IPv4' || (addr.family as unknown) === 4) && !addr.internal) {
        hostname = addr.address
        break
      }
    }
    if (hostname !== 'localhost') break
  }
  return `${hostname} {
  reverse_proxy localhost:${port}
  tls internal
}
`
}

export class NgrokManager {
  private process: ChildProcess | null = null
  private onCrashCallback: (() => void) | null = null
  private stopped = false

  static isInstalled(): boolean {
    try {
      execSync('which ngrok', { stdio: 'ignore', env: EXTENDED_ENV })
      return true
    } catch {
      return false
    }
  }

  setOnCrash(cb: () => void): void {
    this.onCrashCallback = cb
  }

  start(port: number, authToken?: string): Promise<string> {
    this.stopped = false
    const args = ['http', String(port)]
    if (authToken) args.push('--authtoken', authToken)
    this.process = spawn('ngrok', args, { detached: false, env: EXTENDED_ENV })

    const outputLines: string[] = []
    this.process.stdout?.on('data', (chunk: Buffer) => {
      outputLines.push(chunk.toString().trim())
    })
    this.process.stderr?.on('data', (chunk: Buffer) => {
      outputLines.push(chunk.toString().trim())
    })

    this.process.on('exit', (code) => {
      this.process = null
      if (code !== 0 && this.onCrashCallback) {
        this.onCrashCallback()
      }
    })

    return this.pollForUrl(port).catch((err: Error) => {
      const detail = outputLines.slice(-5).join(' | ')
      throw new Error(detail ? `${err.message}: ${detail}` : err.message)
    })
  }

  stop(): void {
    this.stopped = true
    if (this.process) {
      this.onCrashCallback = null // clear before kill so exit event does not trigger crash handler
      this.process.kill('SIGTERM')
      this.process = null
    }
  }

  private async pollForUrl(port: number): Promise<string> {
    for (let i = 0; i < MAX_POLLS; i++) {
      if (this.stopped) throw new Error('ngrok stopped')
      await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS))
      if (this.stopped) throw new Error('ngrok stopped')
      try {
        const res = await fetch('http://localhost:4040/api/tunnels')
        if (res.ok) {
          const data = (await res.json()) as {
            tunnels: Array<{ public_url: string; config?: { addr?: string } }>
          }
          const tunnel = data.tunnels.find(
            (t) =>
              t.public_url.startsWith('https://') && (t.config?.addr?.endsWith(`:${port}`) ?? false)
          )
          if (tunnel) return tunnel.public_url
        }
      } catch {
        // not ready yet
      }
    }
    this.stop()
    throw new Error('ngrok tunnel URL not available after polling')
  }
}
