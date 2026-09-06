import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import React from 'react'

const modelsList = vi.fn()
const modelSet = vi.fn()

vi.mock('../../src/types/electron.js', () => ({
  getSpeckitAPI: () => ({
    credentialsStatus: vi.fn().mockResolvedValue({ connected: false }),
    credentialsSet: vi.fn().mockResolvedValue({ ok: true }),
    modelsList,
    modelSet,
  }),
}))

import { SettingsView } from '../../src/components/SettingsView.js'

// The picker used to be three hardcoded `<option>` tags naming a generation
// that had already shipped its successor — and the value was never read: it was
// stored, rendered, and never reached `--model`.

const box = async (): Promise<HTMLSelectElement> =>
  (await screen.findByLabelText('Default model')) as HTMLSelectElement

describe('SettingsView — the model runs use', () => {
  beforeEach(() => {
    localStorage.clear()
    vi.clearAllMocks()
    modelsList.mockResolvedValue({ models: [], selected: 'opus' })
    modelSet.mockResolvedValue({ ok: true })
  })

  it('offers the aliases without waiting for the main process to answer', async () => {
    modelsList.mockReturnValue(new Promise(() => {}))
    render(<SettingsView />)
    const options = [...(await box()).options].map((option) => option.value)
    expect(options).toEqual(expect.arrayContaining(['', 'opus', 'sonnet', 'haiku', 'fable']))
  })

  it('defaults to an alias, which cannot go a generation stale', async () => {
    render(<SettingsView />)
    expect((await box()).value).toBe('opus')
  })

  it('appends what the account can pin to, once the main process answers', async () => {
    modelsList.mockResolvedValue({
      models: [
        { id: 'opus', label: 'Opus (latest)', floating: true },
        { id: 'claude-opus-5', label: 'Claude Opus 5', floating: false },
      ],
      selected: 'opus',
    })
    render(<SettingsView />)
    await waitFor(() =>
      expect(
        [...screen.getAllByRole('option')].map((o) => (o as HTMLOptionElement).value)
      ).toContain('claude-opus-5')
    )
  })

  it('separates the always-current aliases from the pinned versions', async () => {
    modelsList.mockResolvedValue({
      models: [
        { id: 'opus', label: 'Opus (latest)', floating: true },
        { id: 'claude-opus-5', label: 'Claude Opus 5', floating: false },
      ],
      selected: 'opus',
    })
    const { container } = render(<SettingsView />)
    await waitFor(() =>
      expect([...container.querySelectorAll('optgroup')].map((g) => g.label)).toEqual([
        'Always current',
        'Pin to one version',
      ])
    )
  })

  it('offers no pinning group at all when nothing can be pinned', async () => {
    const { container } = render(<SettingsView />)
    await waitFor(() => expect(container.querySelector('optgroup')).not.toBeNull())
    expect([...container.querySelectorAll('optgroup')].map((g) => g.label)).toEqual([
      'Always current',
    ])
  })

  it('persists the choice where the launch command is built', async () => {
    // The whole bug: this setting lived only in the renderer's localStorage,
    // so the main process — the only thing that builds a `claude` command line
    // — never saw it.
    render(<SettingsView />)
    fireEvent.change(await box(), { target: { value: 'sonnet' } })
    await waitFor(() => expect(modelSet).toHaveBeenCalledWith({ model: 'sonnet' }))
  })

  it('takes the main process as the authority on what is selected', async () => {
    localStorage.setItem('speckit-pilot-global-settings', JSON.stringify({ defaultModel: 'haiku' }))
    modelsList.mockResolvedValue({ models: [], selected: 'sonnet' })
    render(<SettingsView />)
    await waitFor(async () => expect((await box()).value).toBe('sonnet'))
  })

  it('still shows a saved model the list does not offer, rather than lying', async () => {
    // Otherwise the box silently displays a different model from the one every
    // run is actually using.
    modelsList.mockResolvedValue({ models: [], selected: 'some-private-build' })
    render(<SettingsView />)
    await waitFor(async () => expect((await box()).value).toBe('some-private-build'))
  })

  it('keeps working when the bridge has no such channel at all', async () => {
    // An older main process throws on the call itself, not on its promise —
    // which took the whole settings page down.
    modelsList.mockImplementation(() => {
      throw new TypeError('modelsList is not a function')
    })
    render(<SettingsView />)
    expect((await box()).value).toBe('opus')
  })

  it('keeps the choice locally even when persisting it fails', async () => {
    modelSet.mockRejectedValue(new Error('bridge is down'))
    render(<SettingsView />)
    fireEvent.change(await box(), { target: { value: 'haiku' } })
    await waitFor(async () => expect((await box()).value).toBe('haiku'))
  })
})
