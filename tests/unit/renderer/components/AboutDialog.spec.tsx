import React from 'react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { AboutDialog } from '../../../../src/renderer/components/AboutDialog'

const mockGetInfo = vi.fn()
const mockDbHealth = vi.fn()

beforeEach(() => {
  vi.clearAllMocks()
  window.electronAPI = {
    app: { getInfo: mockGetInfo },
    db: { health: mockDbHealth },
  } as unknown as typeof window.electronAPI

  mockDbHealth.mockResolvedValue({ ok: true })
  mockGetInfo.mockResolvedValue({
    appName: 'Terminator',
    version: '1.2.3',
    electronVersion: '30.0.0',
    nodeVersion: '20.0.0',
    chromeVersion: '124.0.0',
    platform: 'darwin',
  })
})

describe('AboutDialog', () => {
  it('renders the dialog with app name and version after loading', async () => {
    render(<AboutDialog onClose={vi.fn()} />)
    await waitFor(() => expect(screen.getByText('Terminator')).toBeTruthy())
    expect(screen.getByText('v1.2.3')).toBeTruthy()
  })

  it('renders version info rows', async () => {
    render(<AboutDialog onClose={vi.fn()} />)
    await waitFor(() => expect(screen.getByText('30.0.0')).toBeTruthy())
    expect(screen.getByText('20.0.0')).toBeTruthy()
    expect(screen.getByText('124.0.0')).toBeTruthy()
    expect(screen.getByText('darwin')).toBeTruthy()
  })

  it('calls onClose when Close button is clicked', async () => {
    const onClose = vi.fn()
    render(<AboutDialog onClose={onClose} />)
    await waitFor(() => expect(screen.getByText('Close')).toBeTruthy())
    fireEvent.click(screen.getByText('Close'))
    expect(onClose).toHaveBeenCalled()
  })

  it('calls onClose when overlay is clicked', async () => {
    const onClose = vi.fn()
    render(<AboutDialog onClose={onClose} />)
    await waitFor(() => expect(screen.getByRole('dialog')).toBeTruthy())
    fireEvent.click(document.querySelector('.dialog-overlay')!)
    expect(onClose).toHaveBeenCalled()
  })

  it('does not call onClose when dialog body is clicked', async () => {
    const onClose = vi.fn()
    render(<AboutDialog onClose={onClose} />)
    await waitFor(() => expect(screen.getByRole('dialog')).toBeTruthy())
    fireEvent.click(screen.getByRole('dialog'))
    expect(onClose).not.toHaveBeenCalled()
  })

  it('calls onClose when Escape is pressed', async () => {
    const onClose = vi.fn()
    render(<AboutDialog onClose={onClose} />)
    await waitFor(() => expect(screen.getByRole('dialog')).toBeTruthy())
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(onClose).toHaveBeenCalled()
  })

  it('shows placeholder dashes before data loads', () => {
    mockGetInfo.mockReturnValue(new Promise(() => {}))
    render(<AboutDialog onClose={vi.fn()} />)
    const dashes = document.querySelectorAll('.about-dialog__row dd')
    expect(dashes.length).toBeGreaterThan(0)
    dashes.forEach((dd) => expect(dd.textContent).toBe('—'))
  })

  it('calls app.getInfo on mount', async () => {
    render(<AboutDialog onClose={vi.fn()} />)
    expect(mockGetInfo).toHaveBeenCalledTimes(1)
    await waitFor(() => screen.getByText('Terminator'))
  })
})
