import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockNetFetch = vi.hoisted(() => vi.fn())
vi.mock('electron', () => ({ net: { fetch: mockNetFetch } }))

import { createExtProtocolHandler } from '../../../../src/main/extensions/ext-protocol'

const BASE_CSS = ':root { --tm-accent: red; }'

function fileResponse(body: string, status = 200) {
  return new Response(body, { status })
}

function makeHandler(directories: Record<string, string | null> = { notepad: '/exts/notepad' }) {
  const directoryOf = (id: string) => directories[id] ?? null
  return createExtProtocolHandler({
    extensionDirectory: directoryOf,
    coreDirectory: '/core',
    baseCss: BASE_CSS,
  })
}

beforeEach(() => {
  mockNetFetch.mockReset()
})

describe('ext-protocol serving files', () => {
  it('serves an extension javascript file untouched with no-store headers', async () => {
    mockNetFetch.mockResolvedValueOnce(fileResponse('console.log(1)'))
    const handler = makeHandler()
    const res = await handler(new Request('ext://notepad/renderer.js'))
    expect(mockNetFetch).toHaveBeenCalledWith('file:///exts/notepad/renderer.js')
    expect(res.status).toBe(200)
    expect(await res.text()).toBe('console.log(1)')
    expect(res.headers.get('Cache-Control')).toBe('no-store')
    expect(res.headers.get('Pragma')).toBe('no-cache')
  })

  it('injects the frame shim script and base css into an extension html page', async () => {
    mockNetFetch.mockResolvedValueOnce(
      fileResponse('<html><head><title>n</title></head><body></body></html>')
    )
    const handler = makeHandler()
    const res = await handler(new Request('ext://notepad/index.html?view=main'))
    const html = await res.text()
    expect(html).toContain(
      '<head>\n    <script type="module" src="ext://core/frame-shim.js"></script>'
    )
    expect(html).toContain(`<style>${BASE_CSS}</style>`)
    expect(res.headers.get('Cache-Control')).toBe('no-store')
  })
})

describe('ext-protocol rejection', () => {
  it('forbids a path that escapes the extension directory', async () => {
    const handler = makeHandler()
    const res = await handler(new Request('ext://notepad/..%2f..%2fsecret.txt'))
    expect(res.status).toBe(403)
    expect(mockNetFetch).not.toHaveBeenCalled()
  })

  it('returns 404 for an unknown extension', async () => {
    const handler = makeHandler()
    const res = await handler(new Request('ext://ghost/index.html'))
    expect(res.status).toBe(404)
  })

  it('returns 404 when the file is missing', async () => {
    mockNetFetch.mockRejectedValueOnce(new Error('ENOENT'))
    const handler = makeHandler()
    const res = await handler(new Request('ext://notepad/missing.js'))
    expect(res.status).toBe(404)
  })
})

describe('ext-protocol core host', () => {
  it('serves frame-shim.js from the core directory', async () => {
    mockNetFetch.mockResolvedValueOnce(fileResponse('// shim'))
    const handler = makeHandler()
    const res = await handler(new Request('ext://core/frame-shim.js'))
    expect(mockNetFetch).toHaveBeenCalledWith('file:///core/frame-shim.js')
    expect(res.status).toBe(200)
    expect(await res.text()).toBe('// shim')
  })

  it('serves the script chunks the shim imports', async () => {
    mockNetFetch.mockResolvedValueOnce(fileResponse('// chunk'))
    const handler = makeHandler()
    const res = await handler(new Request('ext://core/assets/build-api-Bv1MdnBN.js'))
    expect(mockNetFetch).toHaveBeenCalledWith('file:///core/assets/build-api-Bv1MdnBN.js')
    expect(res.status).toBe(200)
  })

  it.each(['other.js', 'assets/font.woff2', 'assets/../remote-shim.js', 'assets/x/y.js'])(
    'serves nothing else from the core directory: %s',
    async (path) => {
      const handler = makeHandler()
      const res = await handler(new Request(`ext://core/${path}`))
      expect(res.status).toBe(404)
      expect(mockNetFetch).not.toHaveBeenCalled()
    }
  )
})
