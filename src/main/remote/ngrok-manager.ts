import { spawn, execSync, type ChildProcess } from 'child_process'

const POLL_INTERVAL_MS = 500
const MAX_POLLS = 60

export class NgrokManager {
  private process: ChildProcess | null = null
  private onCrashCallback: (() => void) | null = null

  static isInstalled(): boolean {
    try {
      execSync('which ngrok', { stdio: 'ignore' })
      return true
    } catch {
      return false
    }
  }

  setOnCrash(cb: () => void): void {
    this.onCrashCallback = cb
  }

  start(port: number, authToken?: string): Promise<string> {
    const args = ['http', String(port)]
    if (authToken) args.push('--authtoken', authToken)
    this.process = spawn('ngrok', args, { detached: false })

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

    return this.pollForUrl().catch((err: Error) => {
      const detail = outputLines.slice(-5).join(' | ')
      throw new Error(detail ? `${err.message}: ${detail}` : err.message)
    })
  }

  stop(): void {
    if (this.process) {
      this.onCrashCallback = null // clear before kill so exit event does not trigger crash handler
      this.process.kill('SIGTERM')
      this.process = null
    }
  }

  private async pollForUrl(): Promise<string> {
    for (let i = 0; i < MAX_POLLS; i++) {
      await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS))
      try {
        const res = await fetch('http://localhost:4040/api/tunnels')
        if (res.ok) {
          const data = (await res.json()) as { tunnels: Array<{ public_url: string }> }
          const tunnel = data.tunnels.find((t) => t.public_url.startsWith('https://'))
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
