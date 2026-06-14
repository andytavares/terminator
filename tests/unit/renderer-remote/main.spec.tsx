import { describe, it, expect, vi } from 'vitest'

const mockRender = vi.fn()
const mockCreateRoot = vi.fn(() => ({ render: mockRender }))

vi.mock('react-dom/client', () => ({ createRoot: mockCreateRoot }))
vi.mock('../../../src/renderer-remote/App', () => ({
  App: () => null,
}))

describe('renderer-remote main', () => {
  it('creates root and renders App when #root exists', async () => {
    const root = document.createElement('div')
    root.id = 'root'
    document.body.appendChild(root)
    await import('../../../src/renderer-remote/main')
    expect(mockCreateRoot).toHaveBeenCalledWith(root)
    expect(mockRender).toHaveBeenCalled()
    document.body.removeChild(root)
  })
})
