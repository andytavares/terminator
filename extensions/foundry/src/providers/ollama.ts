import type { ProviderAdapter, RunRequest, RunEvent } from './adapter.js'

export class OllamaAdapter implements ProviderAdapter {
  readonly supportsStreaming = false

  constructor(
    private readonly providerId: string,
    private readonly model: string,
    private readonly endpoint: string,
    private readonly maxRetries: number = 2,
    private readonly requestDelayMs: number = 0
  ) {}

  async *run(request: RunRequest): AsyncIterable<RunEvent> {
    if (this.requestDelayMs > 0) await new Promise((r) => setTimeout(r, this.requestDelayMs))
    const url = `${this.endpoint.replace(/\/$/, '')}/api/generate`
    const prompt = request.agentsMdContent
      ? `${request.agentsMdContent}\n\n${request.prompt}`
      : request.prompt

    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: request.model || this.model, prompt, stream: true }),
      })

      if (!res.ok || !res.body) {
        yield { type: 'error', message: `Ollama returned ${res.status}` }
        return
      }

      const reader = res.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ''
      let tokenIn = 0
      let tokenOut = 0

      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split('\n')
        buffer = lines.pop() ?? ''
        for (const line of lines) {
          if (!line.trim()) continue
          try {
            const obj = JSON.parse(line) as {
              response?: string
              done?: boolean
              eval_count?: number
              prompt_eval_count?: number
            }
            if (obj.response) yield { type: 'token', token: obj.response }
            if (obj.done) {
              tokenIn = obj.prompt_eval_count ?? 0
              tokenOut = obj.eval_count ?? 0
            }
          } catch {
            // skip malformed line
          }
        }
      }

      yield { type: 'done', tokenCountIn: tokenIn, tokenCountOut: tokenOut }
    } catch (err) {
      yield { type: 'error', message: String(err) }
    }
  }

  async testConnection(): Promise<{ ok: boolean; latencyMs: number }> {
    const start = Date.now()
    try {
      const res = await fetch(`${this.endpoint.replace(/\/$/, '')}/api/tags`)
      if (!res.ok) return { ok: false, latencyMs: Date.now() - start }
      return { ok: true, latencyMs: Date.now() - start }
    } catch {
      return { ok: false, latencyMs: Date.now() - start }
    }
  }
}
