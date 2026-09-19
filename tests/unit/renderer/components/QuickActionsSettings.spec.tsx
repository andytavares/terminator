import React from 'react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { useSettingsStore } from '../../../../src/renderer/stores/settings.store'
import { QuickActionsSettings } from '../../../../src/renderer/components/settings/QuickActionsSettings'
import type { CustomAction } from '../../../../src/shared/types'

vi.mock('../../../../src/renderer/stores/settings.store', () => ({
  useSettingsStore: vi.fn(),
}))

const mockUpdateQuickActions = vi.fn()
const mockUpdateWorkspaceQuickActions = vi.fn()

function mockStore(custom: CustomAction[], workspaceCustom: CustomAction[] = []) {
  vi.mocked(useSettingsStore).mockReturnValue({
    globalSettings: { quickActions: { pins: [], usage: [], directUse: [], custom } },
    workspaceSettings: new Map([
      ['ws-1', { workspaceId: 'ws-1', overrides: { quickActions: { custom: workspaceCustom } } }],
    ]),
    updateQuickActions: mockUpdateQuickActions,
    updateWorkspaceQuickActions: mockUpdateWorkspaceQuickActions,
  } as unknown as ReturnType<typeof useSettingsStore>)
}

beforeEach(() => {
  vi.clearAllMocks()
  Object.defineProperty(globalThis, 'crypto', {
    value: { randomUUID: () => 'new-uuid' },
    configurable: true,
  })
})

describe('QuickActionsSettings — global scope', () => {
  it('shows an empty state with no custom actions', () => {
    mockStore([])
    render(<QuickActionsSettings scope="global" />)
    expect(screen.getByText('No custom actions yet.')).toBeTruthy()
  })

  it('lists existing custom actions', () => {
    mockStore([
      {
        id: 'a1',
        label: 'Run tests',
        mnemonic: 't',
        kind: 'shell',
        target: 'new-tab',
        body: 'npx vitest',
      },
    ])
    render(<QuickActionsSettings scope="global" />)
    expect(screen.getByText('Run tests')).toBeTruthy()
    expect(screen.getByText('shell')).toBeTruthy()
    expect(screen.getByText('New tab on branch')).toBeTruthy()
  })

  it('adds a new action and saves it via updateQuickActions', () => {
    mockStore([])
    render(<QuickActionsSettings scope="global" />)
    fireEvent.click(screen.getByText('Add action'))

    fireEvent.change(screen.getByLabelText('Label'), { target: { value: 'Run tests' } })
    fireEvent.change(screen.getByLabelText('Key'), { target: { value: 't' } })
    fireEvent.change(screen.getByLabelText('Body'), { target: { value: 'npx vitest run' } })
    fireEvent.click(screen.getByText('Save'))

    expect(mockUpdateQuickActions).toHaveBeenCalledWith({
      custom: [
        {
          id: 'new-uuid',
          label: 'Run tests',
          mnemonic: 't',
          kind: 'shell',
          target: 'focused',
          body: 'npx vitest run',
        },
      ],
    })
  })

  it('edits an existing action in place', () => {
    mockStore([
      {
        id: 'a1',
        label: 'Run tests',
        mnemonic: 't',
        kind: 'shell',
        target: 'focused',
        body: 'npx vitest',
      },
    ])
    render(<QuickActionsSettings scope="global" />)
    fireEvent.click(screen.getByText('Edit'))
    fireEvent.change(screen.getByLabelText('Label'), { target: { value: 'Run all tests' } })
    fireEvent.click(screen.getByText('Save'))

    expect(mockUpdateQuickActions).toHaveBeenCalledWith({
      custom: [
        {
          id: 'a1',
          label: 'Run all tests',
          mnemonic: 't',
          kind: 'shell',
          target: 'focused',
          body: 'npx vitest',
        },
      ],
    })
  })

  it('deletes an action', () => {
    mockStore([
      {
        id: 'a1',
        label: 'Run tests',
        mnemonic: 't',
        kind: 'shell',
        target: 'focused',
        body: 'npx vitest',
      },
    ])
    render(<QuickActionsSettings scope="global" />)
    fireEvent.click(screen.getByText('Delete'))
    expect(mockUpdateQuickActions).toHaveBeenCalledWith({ custom: [] })
  })

  it('requires a label', () => {
    mockStore([])
    render(<QuickActionsSettings scope="global" />)
    fireEvent.click(screen.getByText('Add action'))
    fireEvent.change(screen.getByLabelText('Body'), { target: { value: 'echo hi' } })
    fireEvent.click(screen.getByText('Save'))
    expect(screen.getByText('Label is required')).toBeTruthy()
    expect(mockUpdateQuickActions).not.toHaveBeenCalled()
  })

  it('requires a body', () => {
    mockStore([])
    render(<QuickActionsSettings scope="global" />)
    fireEvent.click(screen.getByText('Add action'))
    fireEvent.change(screen.getByLabelText('Label'), { target: { value: 'Run tests' } })
    fireEvent.click(screen.getByText('Save'))
    expect(screen.getByText('Body is required')).toBeTruthy()
    expect(mockUpdateQuickActions).not.toHaveBeenCalled()
  })

  it('keeps only the first character typed into Key', () => {
    mockStore([])
    render(<QuickActionsSettings scope="global" />)
    fireEvent.click(screen.getByText('Add action'))
    const keyInput = screen.getByLabelText('Key') as HTMLInputElement
    fireEvent.change(keyInput, { target: { value: 'ab' } })
    expect(keyInput.value).toBe('a')
  })

  it('rejects a key already used by another action', () => {
    mockStore([
      {
        id: 'a1',
        label: 'Existing',
        mnemonic: 't',
        kind: 'shell',
        target: 'focused',
        body: 'echo hi',
      },
    ])
    render(<QuickActionsSettings scope="global" />)
    fireEvent.click(screen.getByText('Add action'))
    fireEvent.change(screen.getByLabelText('Label'), { target: { value: 'New' } })
    fireEvent.change(screen.getByLabelText('Key'), { target: { value: 't' } })
    fireEvent.change(screen.getByLabelText('Body'), { target: { value: 'echo new' } })
    fireEvent.click(screen.getByText('Save'))
    expect(screen.getByText('Key already used by Existing')).toBeTruthy()
    expect(mockUpdateQuickActions).not.toHaveBeenCalled()
  })

  it('resets target to the first valid option when kind changes', () => {
    mockStore([])
    render(<QuickActionsSettings scope="global" />)
    fireEvent.click(screen.getByText('Add action'))
    fireEvent.change(screen.getByLabelText('Target'), { target: { value: 'new-tab' } })
    fireEvent.change(screen.getByLabelText('Kind'), { target: { value: 'prompt' } })
    expect((screen.getByLabelText('Target') as HTMLSelectElement).value).toBe('agent')
  })

  it('cancel discards the draft without saving', () => {
    mockStore([])
    render(<QuickActionsSettings scope="global" />)
    fireEvent.click(screen.getByText('Add action'))
    fireEvent.change(screen.getByLabelText('Label'), { target: { value: 'Draft' } })
    fireEvent.click(screen.getByText('Cancel'))
    expect(screen.queryByLabelText('Label')).toBeNull()
    expect(mockUpdateQuickActions).not.toHaveBeenCalled()
  })
})

describe('QuickActionsSettings — workspace scope', () => {
  it('reads workspace overrides and writes via updateWorkspaceQuickActions', () => {
    mockStore(
      [],
      [{ id: 'w1', label: 'Workspace action', kind: 'shell', target: 'focused', body: 'ls' }]
    )
    render(<QuickActionsSettings scope="workspace" workspaceId="ws-1" />)
    expect(screen.getByText('Workspace action')).toBeTruthy()

    fireEvent.click(screen.getByText('Delete'))
    expect(mockUpdateWorkspaceQuickActions).toHaveBeenCalledWith('ws-1', [])
    expect(mockUpdateQuickActions).not.toHaveBeenCalled()
  })
})
