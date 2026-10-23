import React from 'react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { useSettingsStore } from '../../../../src/renderer/stores/settings.store'
import { WorkspaceExtensionSettings } from '../../../../src/renderer/components/settings/WorkspaceExtensionSettings'
import { seedStore } from '../../../support/renderer-stores'
import { installElectronApi } from '../../../support/electron-api'
import type { ElectronAPI } from '../../../../src/shared/electron-api/api-type'
import type { WorkspaceSettings } from '../../../../src/shared/types'
import { eventually } from '../../../support/eventually'

// Workspace Settings lists every extension setting declared `workspaceScoped`,
// shows the value that applies in this workspace, saves an edit as this
// workspace's own value, and "Use global default" hands it back.

type ExtensionApi = ElectronAPI['extension']
const WORKSPACE_ID = 'ws-1'
const SIGN_OFF = 'terminator.git-integration.git.commit.signOff'

const schemas: Awaited<ReturnType<ExtensionApi['getSettingsSchemas']>>['schemas'] = [
  {
    extensionId: 'terminator.git-integration',
    label: 'Git Integration',
    properties: {
      [SIGN_OFF]: {
        type: 'boolean',
        label: 'Add sign-off to commits',
        default: false,
        workspaceScoped: true,
      },
      'terminator.git-integration.git.githubToken': {
        type: 'string',
        label: 'GitHub token',
        default: '',
      },
    },
  },
  {
    extensionId: 'terminator.notepad',
    label: 'Notepad',
    properties: {
      'terminator.notepad.autosaveMs': { type: 'number', label: 'Autosave', default: 1 },
    },
  },
]

function workspaceWith(own: Record<string, unknown>): WorkspaceSettings {
  return {
    workspaceId: WORKSPACE_ID,
    overrides: {},
    extensions: { 'terminator.git-integration': own },
  }
}

let updateWorkspaceSetting: ReturnType<typeof vi.fn<ExtensionApi['updateWorkspaceSetting']>>

function setUp(own: Record<string, unknown>, globalValues: Record<string, unknown> = {}) {
  updateWorkspaceSetting = vi.fn<ExtensionApi['updateWorkspaceSetting']>(
    async (_id, key, value) => ({
      settings: workspaceWith(value === undefined ? {} : { [key]: value }),
    })
  )
  installElectronApi({
    extension: {
      getSettingsSchemas: vi.fn<ExtensionApi['getSettingsSchemas']>(async () => ({
        schemas,
      })),
      getSettingsValues: vi.fn<ExtensionApi['getSettingsValues']>(async () => ({
        values: globalValues,
      })),
      onListChanged: vi.fn<ExtensionApi['onListChanged']>(() => () => {}),
      updateWorkspaceSetting,
    },
  })
  seedStore(useSettingsStore, {
    workspaceSettings: new Map([[WORKSPACE_ID, workspaceWith(own)]]),
    updateWorkspaceExtensionSetting:
      useSettingsStore.getInitialState().updateWorkspaceExtensionSetting,
  })
}

const signOffSwitch = () => screen.findByRole('switch', { name: 'Add sign-off to commits' })

describe('WorkspaceExtensionSettings', () => {
  beforeEach(() => setUp({}, { [SIGN_OFF]: true }))

  it('lists only the workspace-scoped settings, under their extension', async () => {
    render(<WorkspaceExtensionSettings workspaceId={WORKSPACE_ID} />)

    expect(await screen.findByText('Git Integration')).toBeTruthy()
    expect(screen.queryByText('GitHub token')).toBeNull()
    expect(screen.queryByText('Notepad')).toBeNull()
  })

  it('shows the global value while the workspace sets none, with no "Use global default"', async () => {
    render(<WorkspaceExtensionSettings workspaceId={WORKSPACE_ID} />)

    expect((await signOffSwitch()).getAttribute('aria-checked')).toBe('true')
    expect(screen.queryByText('Use global default')).toBeNull()
  })

  it("saves an edit as this workspace's own value", async () => {
    render(<WorkspaceExtensionSettings workspaceId={WORKSPACE_ID} />)

    fireEvent.click(await signOffSwitch())

    await eventually(() =>
      expect(updateWorkspaceSetting).toHaveBeenCalledWith(WORKSPACE_ID, SIGN_OFF, false)
    )
    expect(await screen.findByText('Use global default')).toBeTruthy()
  })
})

describe('WorkspaceExtensionSettings — a workspace that sets its own value', () => {
  beforeEach(() => setUp({ [SIGN_OFF]: false }, { [SIGN_OFF]: true }))

  it('shows its own value, and "Use global default" hands the setting back', async () => {
    render(<WorkspaceExtensionSettings workspaceId={WORKSPACE_ID} />)
    expect((await signOffSwitch()).getAttribute('aria-checked')).toBe('false')

    fireEvent.click(screen.getByText('Use global default'))

    await waitFor(() =>
      expect(updateWorkspaceSetting).toHaveBeenCalledWith(WORKSPACE_ID, SIGN_OFF, undefined)
    )
    await waitFor(async () =>
      expect((await signOffSwitch()).getAttribute('aria-checked')).toBe('true')
    )
    expect(screen.queryByText('Use global default')).toBeNull()
  })
})

describe('WorkspaceExtensionSettings — no workspace-scoped settings', () => {
  it('shows nothing', async () => {
    setUp({})
    vi.mocked(window.electronAPI.extension.getSettingsSchemas).mockResolvedValue({
      schemas: [schemas[1]],
    })
    const { container } = render(<WorkspaceExtensionSettings workspaceId={WORKSPACE_ID} />)
    await waitFor(() => expect(window.electronAPI.extension.getSettingsSchemas).toHaveBeenCalled())
    expect(container.textContent).toBe('')
  })
})
