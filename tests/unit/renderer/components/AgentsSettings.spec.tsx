import React from 'react'
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { useSettingsStore } from '../../../../src/renderer/stores/settings.store'
import { AgentsSettings } from '../../../../src/renderer/components/settings/AgentsSettings'
import type { AgentsSettings as AgentsValue } from '../../../../src/shared/types'
import { DEFAULT_GLOBAL_SETTINGS } from '../../../../src/shared/schemas/settings.schema'
import { seedStore, type SeededStore } from '../../../support/renderer-stores'

let settings: SeededStore<typeof useSettingsStore>

const OPENCODE = { id: 'opencode', label: 'OpenCode', command: 'opencode', args: ['acp'] }

function seedAgents(agents: AgentsValue): void {
  settings = seedStore(useSettingsStore, {
    globalSettings: { ...DEFAULT_GLOBAL_SETTINGS, agents },
  })
}

const fill = (label: string, value: string) =>
  fireEvent.change(screen.getByLabelText(label), { target: { value } })

const KNOWN = [
  { ...OPENCODE, installed: true },
  { id: 'cursor', label: 'Cursor', command: 'agent', args: ['acp'], installed: false },
]

beforeEach(() => {
  seedAgents({ default: 'claude', custom: [] })
  window.electronAPI = {
    agents: { known: vi.fn().mockResolvedValue({ data: KNOWN }) },
  } as unknown as typeof window.electronAPI
})

describe('AgentsSettings', () => {
  it('saves a new custom agent with its command line split into command and arguments', () => {
    render(<AgentsSettings />)
    fireEvent.click(screen.getByText('Add agent'))
    fill('Id', 'opencode')
    fill('Label', 'OpenCode')
    fill('Command line', 'opencode acp --log  debug')
    fireEvent.click(screen.getByText('Save'))
    expect(settings.updateAgents).toHaveBeenCalledWith({
      custom: [{ ...OPENCODE, args: ['acp', '--log', 'debug'] }],
    })
  })

  it('refuses an id already used and saves nothing', () => {
    seedAgents({ default: 'claude', custom: [OPENCODE] })
    render(<AgentsSettings />)
    fireEvent.click(screen.getByText('Add agent'))
    fill('Id', 'opencode')
    fill('Label', 'Other')
    fill('Command line', 'other acp')
    fireEvent.click(screen.getByText('Save'))
    expect(screen.getByText('That id is already used')).toBeTruthy()
    expect(settings.updateAgents).not.toHaveBeenCalled()
  })
})

describe('AgentsSettings — default agent', () => {
  it('saves the default agent from the list of built-in and custom agents', () => {
    seedAgents({ default: 'claude', custom: [OPENCODE] })
    render(<AgentsSettings />)
    fireEvent.change(screen.getByLabelText('Default agent'), { target: { value: 'opencode' } })
    expect(settings.updateAgents).toHaveBeenCalledWith({ default: 'opencode' })
  })

  it('returns the default to Claude Code when the default custom agent is removed', () => {
    seedAgents({ default: 'opencode', custom: [OPENCODE] })
    render(<AgentsSettings />)
    fireEvent.click(screen.getByText('Delete'))
    expect(settings.updateAgents).toHaveBeenCalledWith({ default: 'claude', custom: [] })
  })
})

describe('AgentsSettings — known agents', () => {
  it('shows each preset as installed or not, with Add disabled when not installed', async () => {
    render(<AgentsSettings />)
    expect(await screen.findByText('Known agents')).toBeTruthy()
    expect(screen.getByText('Installed')).toBeTruthy()
    expect(screen.getByText('Not installed')).toBeTruthy()
    const [add, addMissing] = screen.getAllByRole('button', { name: /^Add (OpenCode|Cursor)$/ })
    expect((add as HTMLButtonElement).disabled).toBe(false)
    expect((addMissing as HTMLButtonElement).disabled).toBe(true)
  })

  it('adds a preset as the same custom entry a typed agent writes', async () => {
    render(<AgentsSettings />)
    fireEvent.click(await screen.findByRole('button', { name: 'Add OpenCode' }))
    expect(settings.updateAgents).toHaveBeenCalledWith({ custom: [OPENCODE] })
  })

  it('disables Add for a preset already added, and labels the added ones "Your agents"', async () => {
    seedAgents({ default: 'claude', custom: [OPENCODE] })
    render(<AgentsSettings />)
    await waitFor(() =>
      expect(
        (screen.getByRole('button', { name: 'Add OpenCode' }) as HTMLButtonElement).disabled
      ).toBe(true)
    )
    expect(screen.getByText('Your agents')).toBeTruthy()
  })

  it('names the adapter on the built-in Claude row', async () => {
    render(<AgentsSettings />)
    expect(await screen.findByText('claude-agent-acp (built in)')).toBeTruthy()
  })
})
