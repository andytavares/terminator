// The ext:// protocol: serves an extension's renderer files at
// ext://<id>/<path> and the core's frame shim at ext://core/frame-shim.js.
// Moved out of src/main/index.ts (serveExtensionFile) so the handler's wiring
// — which directory, which css — is a parameter the tests can supply.
import { net } from 'electron'
import { join } from 'path'

export interface ExtProtocolSources {
  /** The registered directory of one extension, or null when unknown. */
  extensionDirectory(id: string): string | null
  /** Where the built frame shim lives. Only frame-shim.js is served from it. */
  coreDirectory: string
  /** The design tokens an extension document needs, inlined into its html. */
  baseCss: string
}

// Lowercase: a Headers built from a record appends when the key's case differs
// from one already present, which would double a file's own Cache-Control.
const NO_STORE_HEADERS: Record<string, string> = {
  'cache-control': 'no-store',
  pragma: 'no-cache',
}

async function serveFile(directory: string, relPath: string): Promise<Response> {
  // join() does not see %2f as a separator, so decode first: a request for
  // '..%2f' must be forbidden, not passed to the filesystem as a literal name.
  const relPathDecoded = decodeURIComponent(relPath)
  const fullPath = join(directory, relPathDecoded).replace(/\\/g, '/')
  const root = directory.replace(/\\/g, '/')
  if (fullPath !== root && !fullPath.startsWith(`${root}/`)) {
    return new Response('Forbidden', { status: 403 })
  }
  let res: Response
  try {
    res = await net.fetch(`file://${fullPath}`)
  } catch {
    return new Response(`Not found: ${relPath}`, { status: 404 })
  }
  if (!res.ok) return new Response(`Not found: ${relPath}`, { status: res.status })
  const headers: Record<string, string> = {}
  res.headers.forEach((value, key) => {
    headers[key] = value
  })
  // Extensions change on disk between launches; a cached response is a stale UI.
  Object.assign(headers, NO_STORE_HEADERS)
  return new Response(res.body, { status: res.status, headers })
}

/** The shim and the chunks it imports: its own file, and the scripts in the build's assets. */
function isFrameShimFile(relPath: string): boolean {
  return relPath === 'frame-shim.js' || /^assets\/[\w.-]+\.js$/.test(relPath)
}

/** The shim and base css an extension html page needs, right after <head>. The shim is a module
 * script: it runs before the extension's own module script, which comes after it in the head. */
function injectFrameAssets(html: string, baseCss: string): string {
  const tags = `<script type="module" src="ext://core/frame-shim.js"></script>\n    <style>${baseCss}</style>`
  return html.replace(/<head[^>]*>/i, (head) => `${head}\n    ${tags}`)
}

export function createExtProtocolHandler(
  sources: ExtProtocolSources
): (request: Request) => Promise<Response> {
  return async (request: Request): Promise<Response> => {
    const url = new URL(request.url)
    const host = url.hostname
    const relPath = url.pathname.slice(1)
    if (host === 'core') {
      if (!isFrameShimFile(relPath)) return new Response('Not found', { status: 404 })
      return serveFile(sources.coreDirectory, relPath)
    }
    const directory = sources.extensionDirectory(host)
    if (!directory || !relPath) return new Response('Not found', { status: 404 })
    const res = await serveFile(directory, relPath)
    if (res.ok && relPath.endsWith('.html')) {
      const html = injectFrameAssets(await res.text(), sources.baseCss)
      const headers: Record<string, string> = {}
      res.headers.forEach((value, key) => {
        headers[key] = value
      })
      Object.assign(headers, NO_STORE_HEADERS)
      return new Response(html, { status: res.status, headers })
    }
    return res
  }
}
