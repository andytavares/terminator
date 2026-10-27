import React from 'react'
import { describe, it, expect, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
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

beforeEach(() => seedAgents({ default: 'claude', custom: [] }))

describe('AgentsSettings', () => {
  it('says any ACP agent works, with the example command', () => {
    render(<AgentsSettings />)
    expect(screen.getByText(/any agent that speaks the Agent Client Protocol/i)).toBeTruthy()
    expect(screen.getByText(/opencode acp/)).toBeTruthy()
  })

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
