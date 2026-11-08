import React from 'react'
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent, { type UserEvent } from '@testing-library/user-event'
import { useSettingsStore } from '../../../../src/renderer/stores/settings.store'
import { AgentsSettings } from '../../../../src/renderer/components/settings/AgentsSettings'
import type { AgentsSettings as AgentsValue } from '../../../../src/shared/types'
import type { ElectronAPI } from '../../../../src/shared/electron-api/api-type'
import { DEFAULT_GLOBAL_SETTINGS } from '../../../../src/shared/schemas/settings.schema'
import { resetStore } from '../../../support/renderer-stores'
import { installElectronApi } from '../../../support/electron-api'

const OPENCODE = { id: 'opencode', label: 'OpenCode', command: 'opencode', args: ['acp'] }

const KNOWN = [
  { ...OPENCODE, installed: true },
  { id: 'cursor', label: 'Cursor', command: 'agent', args: ['acp'], installed: false },
]

/** Main's answer to a settings save: the stored settings with the agents patch applied. */
const updateGlobal = vi.fn<ElectronAPI['settings']['updateGlobal']>(async (patch) => {
  const current = useSettingsStore.getState().globalSettings ?? DEFAULT_GLOBAL_SETTINGS
  const { agents } = patch as { agents: Partial<AgentsValue> }
  return { settings: { ...current, agents: { ...current.agents, ...agents } } }
})

function seedAgents(agents: AgentsValue): void {
  resetStore(useSettingsStore, { globalSettings: { ...DEFAULT_GLOBAL_SETTINGS, agents } })
}

async function fill(user: UserEvent, label: string, value: string): Promise<void> {
  await user.type(screen.getByLabelText(label), value)
}

beforeEach(() => {
  updateGlobal.mockClear()
  seedAgents({ default: 'claude', custom: [] })
  installElectronApi({
    agents: { known: vi.fn().mockResolvedValue({ data: KNOWN }) },
    settings: { updateGlobal },
  })
})

describe('AgentsSettings', () => {
  it('saves a new custom agent with its command line split into command and arguments', async () => {
    const user = userEvent.setup()
    render(<AgentsSettings />)
    await user.click(screen.getByRole('button', { name: 'Add agent' }))
    await fill(user, 'Id', 'opencode')
    await fill(user, 'Label', 'OpenCode')
    await fill(user, 'Command line', 'opencode acp --log  debug')
    await user.click(screen.getByRole('button', { name: 'Save' }))
    expect(updateGlobal).toHaveBeenCalledWith({
      agents: { custom: [{ ...OPENCODE, args: ['acp', '--log', 'debug'] }] },
    })
    expect(await screen.findByText('opencode acp --log debug')).toBeTruthy()
  })

  it('refuses an id already used and saves nothing', async () => {
    const user = userEvent.setup()
    seedAgents({ default: 'claude', custom: [OPENCODE] })
    render(<AgentsSettings />)
    await user.click(screen.getByRole('button', { name: 'Add agent' }))
    await fill(user, 'Id', 'opencode')
    await fill(user, 'Label', 'Other')
    await fill(user, 'Command line', 'other acp')
    await user.click(screen.getByRole('button', { name: 'Save' }))
    expect(screen.getByText('That id is already used')).toBeTruthy()
    expect(updateGlobal).not.toHaveBeenCalled()
  })
})

describe('AgentsSettings — default agent', () => {
  it('saves the default agent from the list of built-in and custom agents', async () => {
    const user = userEvent.setup()
    seedAgents({ default: 'claude', custom: [OPENCODE] })
    render(<AgentsSettings />)
    await user.selectOptions(screen.getByLabelText('Default agent'), 'opencode')
    expect(updateGlobal).toHaveBeenCalledWith({ agents: { default: 'opencode' } })
    expect(useSettingsStore.getState().globalSettings?.agents.default).toBe('opencode')
  })

  it('returns the default to Claude Code when the default custom agent is removed', async () => {
    const user = userEvent.setup()
    seedAgents({ default: 'opencode', custom: [OPENCODE] })
    render(<AgentsSettings />)
    await user.click(screen.getByRole('button', { name: 'Delete' }))
    expect(updateGlobal).toHaveBeenCalledWith({ agents: { default: 'claude', custom: [] } })
    expect((screen.getByLabelText('Default agent') as HTMLSelectElement).value).toBe('claude')
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
    const user = userEvent.setup()
    render(<AgentsSettings />)
    await user.click(await screen.findByRole('button', { name: 'Add OpenCode' }))
    expect(updateGlobal).toHaveBeenCalledWith({ agents: { custom: [OPENCODE] } })
  })

  it('disables Add for a preset already added, and labels the added ones "Your agents"', async () => {
    seedAgents({ default: 'claude', custom: [OPENCODE] })
    render(<AgentsSettings />)
    const add = (await screen.findByRole('button', { name: 'Add OpenCode' })) as HTMLButtonElement
    expect(add.disabled).toBe(true)
    expect(screen.getByText('Your agents')).toBeTruthy()
  })

  it('names the adapter on the built-in Claude row', async () => {
    render(<AgentsSettings />)
    expect(await screen.findByText('claude-agent-acp (built in)')).toBeTruthy()
  })
})
