// @vitest-environment happy-dom
// happy-dom, not jsdom: jsdom will not let a test replace `location.reload`, and the reload is the
// behavior here. The renderer reads which extensions are on only at start (initExtensions).
import React from 'react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useWorkspaceStore } from '../../../../src/renderer/stores/workspace.store'
import { SettingsPanel } from '../../../../src/renderer/components/settings/SettingsPanel'
import { extensionOf, seedStore } from '../../../support/renderer-stores'
import { installElectronApi } from '../../../support/electron-api'
import { eventually } from '../../../support/eventually'

vi.mock('../../../../src/renderer/components/settings/GlobalSettings', () => ({
  GlobalSettings: () => <div>GlobalSettings</div>,
}))

const notepad = extensionOf({ id: 'terminator.notepad', name: 'Notepad', status: 'enabled' })

function installMain(toggled: Awaited<ReturnType<typeof window.electronAPI.extension.toggle>>) {
  installElectronApi({
    extension: {
      list: async () => ({ extensions: [notepad] }),
      toggle: async () => toggled,
      getSettingsSchemas: async () => ({ schemas: [] }),
      getSettingsValues: async () => ({ values: {} }),
      onListChanged: () => () => {},
    },
  })
}

beforeEach(() => {
  seedStore(useWorkspaceStore, { activeWorkspaceId: null })
})

describe('ExtensionsSection — switching a bundled extension off', () => {
  it('reloads the window once main has switched it off, so its surfaces go away', async () => {
    const reload = vi.spyOn(window.location, 'reload').mockImplementation(() => {})
    installMain({ extension: { ...notepad, status: 'disabled' } })
    const user = userEvent.setup()
    render(<SettingsPanel onClose={() => {}} />)
    await user.click(screen.getByText('Extensions'))
    await user.click(await screen.findByRole('button', { name: 'Disable' }))
    await eventually(() => expect(reload).toHaveBeenCalledTimes(1))
  })
})
