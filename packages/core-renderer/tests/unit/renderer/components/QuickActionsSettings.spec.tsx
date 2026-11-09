import React from 'react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent, { type UserEvent } from '@testing-library/user-event'
import { useSettingsStore } from '../../../../src/stores/settings.store'
import { QuickActionsSettings } from '../../../../src/components/settings/QuickActionsSettings'
import type { CustomAction } from '../../../../../core-shared/src/types'
import { DEFAULT_GLOBAL_SETTINGS } from '../../../../../core-shared/src/schemas/settings.schema'
import type { ElectronAPI } from '../../../../../core-shared/src/electron-api/api-type'
import type { WorkspaceSettings } from '../../../../../core-shared/src/types'
import { installElectronApi } from '../../../../../test-support/src/electron-api'
import { resetStore, seedStore } from '../../../../../test-support/src/renderer-stores'

/** Main's answer to a global settings save: the stored settings with the patch applied. */
const updateGlobal = vi.fn<ElectronAPI['settings']['updateGlobal']>(async (patch) => {
  const current = useSettingsStore.getState().globalSettings ?? DEFAULT_GLOBAL_SETTINGS
  const { quickActions } = patch as { quickActions: Partial<typeof current.quickActions> }
  return { settings: { ...current, quickActions: { ...current.quickActions, ...quickActions } } }
})
/** Main's answer to a workspace settings save: that workspace's overrides with the patch applied. */
const updateWorkspace = vi.fn<ElectronAPI['settings']['updateWorkspace']>(
  async (workspaceId, patch) => {
    const current = useSettingsStore.getState().workspaceSettings.get(workspaceId)
    const overrides = {
      ...current?.overrides,
      ...(patch as object),
    } as WorkspaceSettings['overrides']
    return { settings: { workspaceId, overrides, extensions: {} } }
  }
)

const savedGlobal = () => useSettingsStore.getState().globalSettings?.quickActions.custom

/** Fills the action form's text fields the person types in. */
async function fillAction(user: UserEvent, fields: { label: string; key: string; body: string }) {
  await typeInto(user, 'Label', fields.label)
  await typeInto(user, 'Key', fields.key)
  await typeInto(user, 'Body', fields.body)
}

/** Replaces what a field holds; an empty `text` leaves it empty. */
async function typeInto(user: UserEvent, label: string, text: string) {
  await user.clear(screen.getByLabelText(label))
  if (text !== '') await user.type(screen.getByLabelText(label), text)
}

function mockStore(custom: CustomAction[], workspaceCustom: CustomAction[] = []) {
  resetStore(useSettingsStore, {
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
  installElectronApi({ settings: { updateGlobal, updateWorkspace } })
  vi.stubGlobal('crypto', { randomUUID: () => 'new-uuid' })
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

describe('QuickActionsSettings — global scope — adds a new action', () => {
  it('saves a new action and lists it', async () => {
    const user = userEvent.setup()
    mockStore([])
    render(<QuickActionsSettings scope="global" />)
    await user.click(screen.getByText('Add action'))

    await fillAction(user, { label: 'Run tests', key: 't', body: 'npx vitest run' })
    await user.click(screen.getByText('Save'))

    expect(await screen.findByText('Run tests')).toBeTruthy()
    expect(savedGlobal()).toEqual([
      {
        id: 'new-uuid',
        label: 'Run tests',
        mnemonic: 't',
        kind: 'shell',
        target: 'focused',
        body: 'npx vitest run',
      },
    ])
  })
})

const runTests: CustomAction = {
  id: 'a1',
  label: 'Run tests',
  mnemonic: 't',
  kind: 'shell',
  target: 'focused',
  body: 'npx vitest',
}

describe('QuickActionsSettings — global scope — edits an existing action in place', () => {
  it('edits an existing action in place', async () => {
    const user = userEvent.setup()
    mockStore([runTests])
    render(<QuickActionsSettings scope="global" />)
    await user.click(screen.getByText('Edit'))
    await typeInto(user, 'Label', 'Run all tests')
    await user.click(screen.getByText('Save'))

    expect(await screen.findByText('Run all tests')).toBeTruthy()
    expect(screen.queryByText('Run tests')).toBeNull()
    expect(savedGlobal()).toEqual([{ ...runTests, label: 'Run all tests' }])
  })
})

describe('QuickActionsSettings — global scope — deletes an action', () => {
  it('deletes an action', async () => {
    const user = userEvent.setup()
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
    await user.click(screen.getByText('Delete'))
    expect(await screen.findByText('No custom actions yet.')).toBeTruthy()
    expect(savedGlobal()).toEqual([])
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
  ])('refuses to save $reason', async (row) => {
    const user = userEvent.setup()
    mockStore([existing])
    render(<QuickActionsSettings scope="global" />)
    await user.click(screen.getByText('Add action'))
    await fillAction(user, row)
    await user.click(screen.getByText('Save'))
    expect(screen.getByText(row.error)).toBeTruthy()
    expect(updateGlobal).not.toHaveBeenCalled()
  })
})

describe('QuickActionsSettings — global scope — the Key field', () => {
  it('keeps only the first character typed into Key', async () => {
    const user = userEvent.setup()
    mockStore([])
    render(<QuickActionsSettings scope="global" />)
    await user.click(screen.getByText('Add action'))
    const keyInput = screen.getByLabelText('Key') as HTMLInputElement
    await user.type(keyInput, 'ab')
    expect(keyInput.value).toBe('a')
  })
})

describe('QuickActionsSettings — global scope — resets target to the first valid option when kind changes', () => {
  it('resets target to the first valid option when kind changes', async () => {
    const user = userEvent.setup()
    mockStore([])
    render(<QuickActionsSettings scope="global" />)
    await user.click(screen.getByText('Add action'))
    await user.selectOptions(screen.getByLabelText('Target'), 'new-tab')
    await user.selectOptions(screen.getByLabelText('Kind'), 'prompt')
    expect((screen.getByLabelText('Target') as HTMLSelectElement).value).toBe('agent')
  })

  it('cancel discards the draft without saving', async () => {
    const user = userEvent.setup()
    mockStore([])
    render(<QuickActionsSettings scope="global" />)
    await user.click(screen.getByText('Add action'))
    await user.type(screen.getByLabelText('Label'), 'Draft')
    await user.click(screen.getByText('Cancel'))
    expect(screen.queryByLabelText('Label')).toBeNull()
    expect(screen.getByText('No custom actions yet.')).toBeTruthy()
    expect(updateGlobal).not.toHaveBeenCalled()
  })
})

describe('QuickActionsSettings — workspace scope', () => {
  it('lists the workspace overrides and deletes from them, leaving the global actions alone', async () => {
    const user = userEvent.setup()
    mockStore(
      [],
      [{ id: 'w1', label: 'Workspace action', kind: 'shell', target: 'focused', body: 'ls' }]
    )
    render(<QuickActionsSettings scope="workspace" workspaceId="ws-1" />)
    expect(screen.getByText('Workspace action')).toBeTruthy()

    await user.click(screen.getByText('Delete'))
    expect(await screen.findByText('No custom actions yet.')).toBeTruthy()
    const workspace = useSettingsStore.getState().workspaceSettings.get('ws-1')
    expect(workspace?.overrides.quickActions?.custom).toEqual([])
    expect(updateGlobal).not.toHaveBeenCalled()
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
    // With no key, the row's text opens on the action's label.
    expect(screen.getByRole('listitem').textContent?.startsWith(askClaude.label)).toBe(true)
  })

  it('edits a keyless action with an empty Key field, and keeps it keyless', async () => {
    const user = userEvent.setup()
    mockStore([askClaude])
    render(<QuickActionsSettings scope="global" />)
    await user.click(screen.getByText('Edit'))
    expect((screen.getByLabelText('Key') as HTMLInputElement).value).toBe('')
    await user.click(screen.getByText('Save'))
    await waitFor(() => expect(updateGlobal).toHaveBeenCalledTimes(1))
    // With no key, the row's text opens on the action's label.
    expect(screen.getByRole('listitem').textContent?.startsWith(askClaude.label)).toBe(true)
    expect(savedGlobal()).toEqual([{ ...askClaude, mnemonic: undefined }])
  })
})
