import React from 'react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { useSettingsStore } from '../../../../src/renderer/stores/settings.store'
import { QuickActionsSettings } from '../../../../src/renderer/components/settings/QuickActionsSettings'
import type { CustomAction } from '../../../../src/shared/types'
import { DEFAULT_GLOBAL_SETTINGS } from '../../../../src/shared/schemas/settings.schema'
import { seedStore, type SeededStore } from '../../../support/renderer-stores'

let settings: SeededStore<typeof useSettingsStore>

function mockStore(custom: CustomAction[], workspaceCustom: CustomAction[] = []) {
  settings = seedStore(useSettingsStore, {
    globalSettings: {
      ...DEFAULT_GLOBAL_SETTINGS,
      quickActions: { ...DEFAULT_GLOBAL_SETTINGS.quickActions, custom },
    },
    workspaceSettings: new Map([
      [
        'ws-1',
        {
          workspaceId: 'ws-1',
          overrides: { quickActions: { custom: workspaceCustom } },
          extensions: {},
        },
      ],
    ]),
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  Object.defineProperty(globalThis, 'crypto', {
    value: { randomUUID: () => 'new-uuid' },
    configurable: true,
  })
})

describe('QuickActionsSettings — the empty state', () => {
  it.each([
    ['with no custom actions', () => mockStore([]), { scope: 'global' }],
    [
      'while global settings have not loaded',
      () => seedStore(useSettingsStore, { globalSettings: null, workspaceSettings: new Map() }),
      { scope: 'global' },
    ],
    [
      'for a workspace with no settings of its own',
      () => mockStore([]),
      { scope: 'workspace', workspaceId: 'ws-unknown' },
    ],
  ] as const)('shows the empty state %s', (_case, seed, props) => {
    seed()
    render(<QuickActionsSettings {...props} />)
    expect(screen.getByText('No custom actions yet.')).toBeTruthy()
  })
})

describe('QuickActionsSettings — global scope', () => {
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
})

describe('QuickActionsSettings — global scope — adds a new action and saves it via updateQuickActions', () => {
  it('adds a new action and saves it via updateQuickActions', () => {
    mockStore([])
    render(<QuickActionsSettings scope="global" />)
    fireEvent.click(screen.getByText('Add action'))

    fireEvent.change(screen.getByLabelText('Label'), { target: { value: 'Run tests' } })
    fireEvent.change(screen.getByLabelText('Key'), { target: { value: 't' } })
    fireEvent.change(screen.getByLabelText('Body'), { target: { value: 'npx vitest run' } })
    fireEvent.click(screen.getByText('Save'))

    expect(settings.updateQuickActions).toHaveBeenCalledWith({
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
})

describe('QuickActionsSettings — global scope — edits an existing action in place', () => {
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

    expect(settings.updateQuickActions).toHaveBeenCalledWith({
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
})

describe('QuickActionsSettings — global scope — deletes an action', () => {
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
    expect(settings.updateQuickActions).toHaveBeenCalledWith({ custom: [] })
  })
})

const existing: CustomAction = {
  id: 'a1',
  label: 'Existing',
  mnemonic: 't',
  kind: 'shell',
  target: 'focused',
  body: 'echo hi',
}

describe('QuickActionsSettings — global scope — validation', () => {
  it.each([
    { reason: 'a missing label', label: '', key: '', body: 'echo hi', error: 'Label is required' },
    { reason: 'a missing body', label: 'Run tests', key: '', body: '', error: 'Body is required' },
    {
      reason: 'a key already used by another action',
      label: 'New',
      key: 't',
      body: 'echo new',
      error: 'Key already used by Existing',
    },
  ])('refuses to save $reason', (row) => {
    mockStore([existing])
    render(<QuickActionsSettings scope="global" />)
    fireEvent.click(screen.getByText('Add action'))
    fireEvent.change(screen.getByLabelText('Label'), { target: { value: row.label } })
    fireEvent.change(screen.getByLabelText('Key'), { target: { value: row.key } })
    fireEvent.change(screen.getByLabelText('Body'), { target: { value: row.body } })
    fireEvent.click(screen.getByText('Save'))
    expect(screen.getByText(row.error)).toBeTruthy()
    expect(settings.updateQuickActions).not.toHaveBeenCalled()
  })
})

describe('QuickActionsSettings — global scope — the Key field', () => {
  it('keeps only the first character typed into Key', () => {
    mockStore([])
    render(<QuickActionsSettings scope="global" />)
    fireEvent.click(screen.getByText('Add action'))
    const keyInput = screen.getByLabelText('Key') as HTMLInputElement
    fireEvent.change(keyInput, { target: { value: 'ab' } })
    expect(keyInput.value).toBe('a')
  })
})

describe('QuickActionsSettings — global scope — resets target to the first valid option when kind changes', () => {
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
    expect(settings.updateQuickActions).not.toHaveBeenCalled()
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
    expect(settings.updateWorkspaceQuickActions).toHaveBeenCalledWith('ws-1', [])
    expect(settings.updateQuickActions).not.toHaveBeenCalled()
  })
})

const askClaude: CustomAction = {
  id: 'a2',
  label: 'Ask Claude',
  kind: 'prompt',
  target: 'agent',
  body: 'review this',
}

describe('QuickActionsSettings — actions without a key, and scopes with nothing yet', () => {
  it('lists a prompt action against the focused Claude session, with no key', () => {
    mockStore([askClaude])
    render(<QuickActionsSettings scope="global" />)
    expect(screen.getByText('Focused agent session')).toBeTruthy()
    expect(document.querySelector('.qa-settings-list__key')!.textContent).toBe('')
  })

  it('edits a keyless action with an empty Key field, and keeps it keyless', () => {
    mockStore([askClaude])
    render(<QuickActionsSettings scope="global" />)
    fireEvent.click(screen.getByText('Edit'))
    expect((screen.getByLabelText('Key') as HTMLInputElement).value).toBe('')
    fireEvent.click(screen.getByText('Save'))
    expect(settings.updateQuickActions).toHaveBeenCalledWith({
      custom: [{ ...askClaude, mnemonic: undefined }],
    })
  })
})
