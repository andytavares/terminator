import React from 'react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { AboutDialog } from '../../../../src/renderer/components/AboutDialog'
import type { ElectronAPI } from '../../../../src/shared/electron-api/api-type'
import { installElectronApi } from '../../../support/electron-api'

const mockGetInfo = vi.fn<ElectronAPI['app']['getInfo']>()
const mockDbHealth = vi.fn<ElectronAPI['db']['health']>()
const mockExtensionList = vi.fn<ElectronAPI['extension']['list']>()

beforeEach(() => {
  vi.clearAllMocks()
  installElectronApi({
    app: { getInfo: mockGetInfo },
    db: { health: mockDbHealth },
    extension: { list: mockExtensionList },
  })

  mockDbHealth.mockResolvedValue({ ok: true })
  mockExtensionList.mockResolvedValue({ extensions: [] })
  mockGetInfo.mockResolvedValue({
    appName: 'Terminator',
    version: '1.2.3',
    electronVersion: '30.0.0',
    nodeVersion: '20.0.0',
    chromeVersion: '124.0.0',
    platform: 'darwin',
    homeDir: '/Users/me',
  })
})

const recordUse = vi.hoisted(() => vi.fn())
vi.mock('../../../../src/renderer/usage/record', () => ({ recordUse }))

describe('AboutDialog', () => {
  it('renders the dialog with app name and version after loading', async () => {
    render(<AboutDialog onClose={vi.fn()} />)
    // The title is drawn at once; the version arrives with the app info.
    expect(await screen.findByText('v1.2.3')).toBeTruthy()
    expect(screen.getByText('Terminator')).toBeTruthy()
  })

  it('renders version info rows', async () => {
    render(<AboutDialog onClose={vi.fn()} />)
    await screen.findByText('30.0.0')
    expect(screen.getByText('20.0.0')).toBeTruthy()
    expect(screen.getByText('124.0.0')).toBeTruthy()
    expect(screen.getByText('darwin')).toBeTruthy()
  })

  it('calls onClose when Close button is clicked', async () => {
    const user = userEvent.setup()
    const onClose = vi.fn()
    render(<AboutDialog onClose={onClose} />)
    // The dialog's corner X is also named Close; the footer button is the one with the word.
    await user.click(await screen.findByText('Close'))
    expect(onClose).toHaveBeenCalled()
  })
})

describe('AboutDialog — extension versions', () => {
  const extension = (name: string, version: string) => ({
    id: `terminator.${name.toLowerCase()}`,
    name,
    version,
    description: '',
    entryPoint: 'src/index.js',
    status: 'enabled' as const,
    installedAt: '2026-10-29T12:00:00.000Z',
  })

  it('lists each installed extension with its version', async () => {
    mockExtensionList.mockResolvedValue({
      extensions: [extension('Foundry', '0.1.4'), extension('Notepad', '0.1.0')],
    })
    render(<AboutDialog onClose={vi.fn()} />)
    expect((await screen.findByText('Foundry')).nextElementSibling!.textContent).toBe('v0.1.4')
    expect(screen.getByText('Notepad').nextElementSibling!.textContent).toBe('v0.1.0')
  })

  it('shows no extensions section when the list cannot be read', async () => {
    mockExtensionList.mockRejectedValue(new Error('IPC gone'))
    render(<AboutDialog onClose={vi.fn()} />)
    await screen.findByText('OK')
    expect(screen.queryByText('Extensions')).toBeNull()
  })
})

describe('AboutDialog — calls onClose when Escape is pressed', () => {
  it('calls onClose when Escape is pressed', async () => {
    const user = userEvent.setup()
    const onClose = vi.fn()
    render(<AboutDialog onClose={onClose} />)
    await screen.findByRole('dialog')
    await user.keyboard('{Escape}')
    expect(onClose).toHaveBeenCalled()
  })

  it('shows a dash for each version before the app info loads', () => {
    mockGetInfo.mockReturnValue(new Promise(() => {}))
    render(<AboutDialog onClose={vi.fn()} />)
    const values = ['Electron', 'Node', 'Chrome', 'Platform'].map(
      (label) => screen.getByText(label).nextElementSibling!.textContent
    )
    expect(values).toEqual(['—', '—', '—', '—'])
  })
})

describe('AboutDialog — keeps the placeholders when the app info cannot be read', () => {
  it('keeps the placeholders when the app info cannot be read', async () => {
    mockGetInfo.mockRejectedValue(new Error('IPC gone'))
    render(<AboutDialog onClose={vi.fn()} />)
    // The database row settles from its own call; by then the rejection has too.
    await screen.findByText('OK')
    expect(screen.getByText('v—')).toBeTruthy()
    expect(screen.getByText('Electron').nextElementSibling!.textContent).toBe('—')
  })

  it('shows DB error with message when health returns ok:false', async () => {
    mockDbHealth.mockResolvedValue({ ok: false, message: 'disk full' })
    render(<AboutDialog onClose={vi.fn()} />)
    await screen.findByText('Error — disk full')
  })

  it('shows DB error with "unknown" when health returns ok:false without message', async () => {
    mockDbHealth.mockResolvedValue({ ok: false })
    render(<AboutDialog onClose={vi.fn()} />)
    await screen.findByText('Error — unknown')
  })

  it('shows IPC error when db.health rejects', async () => {
    mockDbHealth.mockRejectedValue(new Error('IPC failed'))
    render(<AboutDialog onClose={vi.fn()} />)
    await screen.findByText('Error — IPC error')
  })
})
