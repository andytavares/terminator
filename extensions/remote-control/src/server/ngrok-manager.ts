import { spawn, execSync, type ChildProcess } from 'child_process'
import { rmSync, writeFileSync } from 'fs'
import { createServer } from 'net'
import { networkInterfaces, tmpdir } from 'os'
import { join } from 'path'

// Packaged Electron apps launch without the user's shell, so Homebrew paths are absent.
// They come after the person's own PATH, so an ngrok they put first is the one that runs.
const EXTRA_PATH = ['/opt/homebrew/bin', '/usr/local/bin', '/usr/bin', '/bin'].join(':')
const EXTENDED_ENV = {
  ...process.env,
  PATH: [process.env.PATH, EXTRA_PATH].filter(Boolean).join(':'),
}

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

/** A port nothing listens on now, from the OS. */
function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer()
    server.on('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address() as { port: number }
      server.close(() => resolve(port))
    })
  })
}

/** The person's own ngrok config file, which holds their authtoken; null when they have none. */
function userConfigPath(): string | null {
  try {
    const answer = execSync('ngrok config check', { env: EXTENDED_ENV, encoding: 'utf8' })
    return /configuration file at (.+)$/m.exec(answer)?.[1].trim() ?? null
  } catch {
    return null
  }
}

/**
 * `--config` for an agent whose API is on `apiPort` rather than the default 4040, which another
 * ngrok the person runs may hold. Later files win when ngrok merges them, so theirs comes first.
 */
function agentConfigArgs(apiPort: number): string[] {
  const own = ownConfigPath()
  writeFileSync(own, `version: "3"\nagent:\n  web_addr: 127.0.0.1:${apiPort}\n`)
  return ['--config', [userConfigPath(), own].filter(Boolean).join(',')]
}

function ownConfigPath(): string {
  return join(tmpdir(), `terminator-ngrok-${process.pid}.yml`)
}

/** Once ngrok is gone its file is not needed, and each launch of the app would leave one more. */
function removeOwnConfig(): void {
  rmSync(ownConfigPath(), { force: true })
}

export class NgrokManager {
  private process: ChildProcess | null = null
  private onCrashCallback: (() => void) | null = null
  private stopped = false
  private exited: Promise<void> = Promise.resolve()

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

  async start(port: number, authToken?: string): Promise<string> {
    this.stopped = false
    const apiPort = await freePort()
    const args = ['http', String(port), ...agentConfigArgs(apiPort)]
    if (authToken) args.push('--authtoken', authToken)
    const child = spawn('ngrok', args, { detached: false, env: EXTENDED_ENV })
    this.process = child

    const outputLines: string[] = []
    this.process.stdout?.on('data', (chunk: Buffer) => {
      outputLines.push(chunk.toString().trim())
    })
    this.process.stderr?.on('data', (chunk: Buffer) => {
      outputLines.push(chunk.toString().trim())
    })

    this.process.on('exit', (code) => {
      this.process = null
      removeOwnConfig()
      if (code !== 0 && this.onCrashCallback) {
        this.onCrashCallback()
      }
    })
    // 'error' too: a process that never started never exits.
    this.exited = new Promise<void>((resolve) => {
      child.on('exit', () => resolve())
      child.on('error', () => resolve())
    })

    return this.pollForUrl(port, apiPort).catch((err: Error) => {
      const detail = outputLines.slice(-5).join(' | ')
      throw new Error(detail ? `${err.message}: ${detail}` : err.message)
    })
  }

  /** Settles once the ngrok process has exited. */
  async stop(): Promise<void> {
    this.terminate()
    await this.exited
  }

  private terminate(): void {
    this.stopped = true
    if (this.process) {
      this.onCrashCallback = null // clear before kill so exit event does not trigger crash handler
      this.process.kill('SIGTERM')
      this.process = null
    }
    removeOwnConfig()
  }

  private async pollForUrl(port: number, apiPort: number): Promise<string> {
    for (let i = 0; i < MAX_POLLS; i++) {
      if (this.stopped) throw new Error('ngrok stopped')
      await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS))
      if (this.stopped) throw new Error('ngrok stopped')
      try {
        const res = await fetch(`http://127.0.0.1:${apiPort}/api/tunnels`)
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
    this.terminate()
    throw new Error('ngrok tunnel URL not available after polling')
  }
}
