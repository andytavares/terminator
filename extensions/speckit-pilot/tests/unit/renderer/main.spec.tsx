import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockRender = vi.fn()
const mockCreateRoot = vi.fn(() => ({ render: mockRender }))

vi.mock('react-dom/client', () => ({ createRoot: mockCreateRoot }))
vi.mock('../../../src/renderer/App', () => ({ App: () => null }))

describe('speckit-pilot renderer main', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
    mockCreateRoot.mockReturnValue({ render: mockRender })
    document.body.innerHTML = '<div id="app"></div>'
  })

  it('mounts App to the #app element', async () => {
    await import('../../../src/renderer/main')
    expect(mockCreateRoot).toHaveBeenCalledWith(document.getElementById('app'))
    expect(mockRender).toHaveBeenCalled()
  })

  it('throws when #app element is missing', async () => {
    document.body.innerHTML = ''
    await expect(import('../../../src/renderer/main')).rejects.toThrow('No #app element')
  })
})
