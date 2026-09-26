import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import React from 'react'
import { SettingsView } from '../../src/components/SettingsView.js'

// Everything Foundry can be configured with is registered through the
// application's own settings API, except the sensors panel — one row per
// sensor, where the operator turns it on, points it at a repository, and
// sees what it last did.

let invoke: ReturnType<typeof vi.fn>

function sensorRow(over: Record<string, unknown> = {}) {
  return {
    def: { id: 'ci-flake', description: 'CI flake watch' },
    rung: 'data-root',
    state: {
      enabled: false,
      repoPath: null,
      lastRunAt: null,
      lastProblem: null,
      ...(over.state as object satisfies object | undefined),
    },
    nextDueAt: null,
    ...over,
  }
}

function mount(over: Record<string, unknown> = {}) {
  const sensors = [...(((over.sensors as unknown[] | undefined) ?? [sensorRow()]) as unknown[])]
  invoke = vi.fn(async (channel: string, payload?: unknown) => {
    if (channel === 'foundry:models-list') return { models: [], selected: '' }
    if (channel === 'foundry:ask-model') return { selected: over.askModel ?? 'sonnet' }
    if (channel === 'foundry:ask-model-set')
      return { ok: true, selected: (payload as { model: string }).model }
    if (channel === 'foundry:sensors.list') return { sensors }
    if (channel === 'foundry:sensors.set') {
      const { id, enabled, repoPath } = payload as {
        id: string
        enabled?: boolean
        repoPath?: string | null
      }
      const row = sensors.find((s) => (s as { def: { id: string } }).def.id === id) as
        | { state: { enabled: boolean; repoPath: string | null } }
        | undefined
      if (row === undefined) return { error: `No sensor ${id}.` }
      const nextRepoPath = repoPath === undefined ? row.state.repoPath : repoPath
      const nextEnabled = enabled ?? row.state.enabled
      if (nextEnabled && nextRepoPath === null) {
        return { error: 'A sensor needs a repository before it can be enabled.' }
      }
      row.state.enabled = nextEnabled
      row.state.repoPath = nextRepoPath
      return { state: row.state }
    }
    if (channel === 'foundry:sensors.run-now') {
      return over.runNow ?? { recorded: 2, problem: null }
    }
    return { ok: true }
  })
  ;(window as unknown as Record<string, unknown>).electronAPI = {
    extensionBridge: { invoke, on: vi.fn(() => vi.fn()) },
  }
  render(<SettingsView />)
}

beforeEach(() => vi.clearAllMocks())

describe('the sensors panel', () => {
  it('shows one row per sensor, with its description and rung', async () => {
    mount()
    await waitFor(() => expect(screen.getByText('CI flake watch')).toBeTruthy())
    expect(screen.getByText('data-root')).toBeTruthy()
  })

  it('refuses to enable a sensor with no repository, and shows why', async () => {
    mount()
    await waitFor(() => screen.getByText('CI flake watch'))
    fireEvent.click(screen.getByRole('checkbox', { name: /Enable CI flake watch/i }))
    await waitFor(() =>
      expect(screen.getByText('A sensor needs a repository before it can be enabled.')).toBeTruthy()
    )
  })

  it('enables once a repository is given', async () => {
    mount()
    await waitFor(() => screen.getByText('CI flake watch'))
    fireEvent.change(screen.getByRole('textbox', { name: /Repository for CI flake watch/i }), {
      target: { value: '/repos/app' },
    })
    fireEvent.click(screen.getByRole('checkbox', { name: /Enable CI flake watch/i }))
    await waitFor(() =>
      expect(invoke).toHaveBeenCalledWith('foundry:sensors.set', {
        id: 'ci-flake',
        enabled: true,
        repoPath: '/repos/app',
      })
    )
    await waitFor(() =>
      expect(
        (screen.getByRole('checkbox', { name: /Enable CI flake watch/i }) as HTMLInputElement)
          .checked
      ).toBe(true)
    )
  })

  it('shows the last run, next due and last problem', async () => {
    mount({
      sensors: [
        sensorRow({
          state: {
            enabled: true,
            repoPath: '/repos/app',
            lastRunAt: '2026-09-20T10:00:00.000Z',
            lastProblem: 'the toolchain was unavailable',
          },
          nextDueAt: '2026-09-20T12:00:00.000Z',
        }),
      ],
    })
    await waitFor(() => screen.getByText('CI flake watch'))
    expect(screen.getByText(/2026-09-20T10:00:00.000Z/)).toBeTruthy()
    expect(screen.getByText(/2026-09-20T12:00:00.000Z/)).toBeTruthy()
    expect(screen.getByText(/the toolchain was unavailable/)).toBeTruthy()
  })

  it('runs a sensor now and shows what it recorded', async () => {
    mount({ runNow: { recorded: 3, problem: null } })
    await waitFor(() => screen.getByText('CI flake watch'))
    fireEvent.click(screen.getByRole('button', { name: 'Run now' }))
    await waitFor(() =>
      expect(invoke).toHaveBeenCalledWith('foundry:sensors.run-now', { id: 'ci-flake' })
    )
    expect(await screen.findByText(/3/)).toBeTruthy()
  })

  it('runs a sensor now and shows the problem it hit', async () => {
    mount({ runNow: { recorded: 0, problem: 'could not reach the repository' } })
    await waitFor(() => screen.getByText('CI flake watch'))
    fireEvent.click(screen.getByRole('button', { name: 'Run now' }))
    expect(await screen.findByText(/could not reach the repository/)).toBeTruthy()
  })
})

describe('the model that answers asks', () => {
  it('shows Sonnet chosen by default', async () => {
    mount()
    const sonnet = await screen.findByRole('button', { name: /Sonnet/ })
    expect(sonnet.getAttribute('aria-pressed')).toBe('true')
    expect(screen.getByRole('button', { name: /Opus/ }).getAttribute('aria-pressed')).toBe('false')
  })

  it('switches asks to Opus and saves the choice', async () => {
    mount()
    fireEvent.click(await screen.findByRole('button', { name: /Opus/ }))
    await waitFor(() =>
      expect(invoke).toHaveBeenCalledWith('foundry:ask-model-set', { model: 'opus' })
    )
    await waitFor(() =>
      expect(screen.getByRole('button', { name: /Opus/ }).getAttribute('aria-pressed')).toBe('true')
    )
  })

  it('shows Opus chosen when that is what was saved', async () => {
    mount({ askModel: 'opus' })
    await waitFor(() =>
      expect(screen.getByRole('button', { name: /Opus/ }).getAttribute('aria-pressed')).toBe('true')
    )
  })
})
