import type { IncomingMessage, ServerResponse } from 'node:http'

/** The whole body of a request to a stub server, as text. */
export function readRequestBody(request: IncomingMessage): Promise<string> {
  return new Promise((resolve) => {
    let body = ''
    request.on('data', (chunk) => (body += chunk))
    request.on('end', () => resolve(body))
  })
}

/** A request's JSON body, or null when it has none. */
export async function readJsonBody(request: IncomingMessage): Promise<unknown> {
  const body = await readRequestBody(request)
  return body ? JSON.parse(body) : null
}

/** Answers with `body` as JSON. */
export function sendJson(response: ServerResponse, status: number, body: unknown): void {
  response.writeHead(status, { 'Content-Type': 'application/json' })
  response.end(JSON.stringify(body))
}
