import React from 'react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { act, render, screen, waitFor } from '@testing-library/react'
import { ContributionsOnHome } from '../../src/components/contributions/ContributionsOnHome'

const SHOW_KEY = 'terminator.git-integration.home.showContributions'
const getSettingsValues = vi.fn()
const changeListeners = new Set<() => void>()

beforeEach(() => {
  vi.clearAllMocks()
  changeListeners.clear()
  Object.defineProperty(window, 'electronAPI', {
    value: {
      // The section's own load never answers: these tests are about whether it shows at all.
      extensionBridge: { invoke: vi.fn(() => new Promise(() => {})) },
      extension: {
        getSettingsValues,
        onSettingsChanged: (handler: () => void) => {
          changeListeners.add(handler)
          return () => void changeListeners.delete(handler)
        },
      },
    },
    configurable: true,
    writable: true,
  })
})

const refresh = { name: 'Refresh contributions' }
const sectionShown = () => screen.findByRole('button', refresh)
const sectionGone = () => screen.queryByRole('button', refresh)

describe('ContributionsOnHome', () => {
  it('shows the section when the setting was never changed', async () => {
    getSettingsValues.mockResolvedValue({ values: {} })
    render(<ContributionsOnHome />)
    expect(await sectionShown()).toBeTruthy()
  })

  it('shows nothing when "Show contributions on Home" is off', async () => {
    getSettingsValues.mockResolvedValue({ values: { [SHOW_KEY]: false } })
    const { container } = render(<ContributionsOnHome />)
    await waitFor(() => expect(getSettingsValues).toHaveBeenCalled())
    await act(async () => {})
    expect(container.innerHTML).toBe('')
  })
})

describe('ContributionsOnHome — switching the setting', () => {
  it('hides and shows again as the setting is switched, without a reload', async () => {
    getSettingsValues.mockResolvedValue({ values: { [SHOW_KEY]: true } })
    render(<ContributionsOnHome />)
    expect(await sectionShown()).toBeTruthy()

    getSettingsValues.mockResolvedValue({ values: { [SHOW_KEY]: false } })
    act(() => changeListeners.forEach((listener) => listener()))
    await waitFor(() => expect(sectionGone()).toBeNull())

    getSettingsValues.mockResolvedValue({ values: { [SHOW_KEY]: true } })
    act(() => changeListeners.forEach((listener) => listener()))
    expect(await sectionShown()).toBeTruthy()
  })

  it('stops listening when Home goes away', () => {
    getSettingsValues.mockResolvedValue({ values: {} })
    const { unmount } = render(<ContributionsOnHome />)
    unmount()
    expect(changeListeners.size).toBe(0)
  })
})
