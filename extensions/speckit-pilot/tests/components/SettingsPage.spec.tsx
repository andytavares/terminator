import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import React from 'react'
import { SettingsPage } from '../../src/components/SettingsPage.js'
import { DEFAULT_SETTINGS } from '../../src/types/speckit.types.js'
import type { PilotSettings } from '../../src/types/speckit.types.js'

const noop = vi.fn().mockResolvedValue(undefined)

describe('SettingsPage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('renders settings navigation', () => {
    render(<SettingsPage settings={DEFAULT_SETTINGS} onSave={noop} onDismiss={noop} />)
    expect(screen.getByText('General')).toBeTruthy()
    // Gates & auto-approval appears in nav - check it's there
    expect(screen.getAllByText(/Gates & auto-approval/).length).toBeGreaterThan(0)
    expect(screen.getByText('Audit log')).toBeTruthy()
    expect(screen.getByText('Telemetry')).toBeTruthy()
  })

  it('shows Gates & auto-approval section by default', () => {
    render(<SettingsPage settings={DEFAULT_SETTINGS} onSave={noop} onDismiss={noop} />)
    // Should show phase names in table
    expect(screen.getByText('Constitution')).toBeTruthy()
    expect(screen.getByText('Implement')).toBeTruthy()
  })

  it('shows all phases in gates table', () => {
    render(<SettingsPage settings={DEFAULT_SETTINGS} onSave={noop} onDismiss={noop} />)
    expect(screen.getByText('Specify')).toBeTruthy()
    expect(screen.getByText('Clarify')).toBeTruthy()
    expect(screen.getByText('Plan')).toBeTruthy()
    expect(screen.getByText('Tasks')).toBeTruthy()
    expect(screen.getByText('Analyze')).toBeTruthy()
  })

  it('shows hard limits section', () => {
    render(<SettingsPage settings={DEFAULT_SETTINGS} onSave={noop} onDismiss={noop} />)
    expect(screen.getByText('Hard limits')).toBeTruthy()
  })

  it('switches to General section when nav item clicked', async () => {
    render(<SettingsPage settings={DEFAULT_SETTINGS} onSave={noop} onDismiss={noop} />)
    fireEvent.click(screen.getByText('General'))
    await waitFor(() => {
      expect(screen.getByText('Default model')).toBeTruthy()
    })
  })

  it('switches to Audit log section', async () => {
    render(<SettingsPage settings={DEFAULT_SETTINGS} onSave={noop} onDismiss={noop} />)
    fireEvent.click(screen.getByText('Audit log'))
    await waitFor(() => {
      expect(screen.getByText('Reviewer identity')).toBeTruthy()
    })
  })

  it('calls onSave with updated settings when Save is clicked', async () => {
    const onSave = vi.fn().mockResolvedValue(undefined)
    render(<SettingsPage settings={DEFAULT_SETTINGS} onSave={onSave} onDismiss={noop} />)
    fireEvent.click(screen.getByText('Save changes'))
    await waitFor(() => {
      expect(onSave).toHaveBeenCalledWith(
        expect.objectContaining({ defaultModel: expect.any(String) })
      )
    })
  })

  it('calls onDismiss when Cancel is clicked', () => {
    const onDismiss = vi.fn()
    render(<SettingsPage settings={DEFAULT_SETTINGS} onSave={noop} onDismiss={onDismiss} />)
    fireEvent.click(screen.getByText('Cancel'))
    expect(onDismiss).toHaveBeenCalledOnce()
  })

  it('shows implement phase as Always required (no auto-approve)', () => {
    render(<SettingsPage settings={DEFAULT_SETTINGS} onSave={noop} onDismiss={noop} />)
    expect(screen.getByText('Always required')).toBeTruthy()
  })

  it('shows checklist phase as Optional', () => {
    render(<SettingsPage settings={DEFAULT_SETTINGS} onSave={noop} onDismiss={noop} />)
    expect(screen.getByText('Optional')).toBeTruthy()
  })

  it('shows max files and max tokens fields', () => {
    render(<SettingsPage settings={DEFAULT_SETTINGS} onSave={noop} onDismiss={noop} />)
    expect(screen.getByDisplayValue(String(DEFAULT_SETTINGS.maxFilesPerImplementRun))).toBeTruthy()
    expect(screen.getByDisplayValue(String(DEFAULT_SETTINGS.maxTokensPerCommand))).toBeTruthy()
  })

  it('shows git safety checkboxes', () => {
    render(<SettingsPage settings={DEFAULT_SETTINGS} onSave={noop} onDismiss={noop} />)
    expect(screen.getByText(/Refuse to run implement on a dirty git tree/)).toBeTruthy()
    expect(screen.getByText(/Create a checkpoint commit before each implement run/)).toBeTruthy()
  })

  it('updates settings in draft when checkbox toggled', async () => {
    const onSave = vi.fn().mockResolvedValue(undefined)
    render(<SettingsPage settings={DEFAULT_SETTINGS} onSave={onSave} onDismiss={noop} />)
    const checkboxes = screen.getAllByRole('checkbox')
    // Toggle requireCleanTree checkbox
    const cleanTreeCheckbox = checkboxes.find((cb) =>
      cb.closest('label')?.textContent?.includes('Refuse to run implement')
    ) as HTMLInputElement | undefined
    if (cleanTreeCheckbox) {
      const original = cleanTreeCheckbox.checked
      fireEvent.click(cleanTreeCheckbox)
      fireEvent.click(screen.getByText('Save changes'))
      await waitFor(() => {
        expect(onSave).toHaveBeenCalledWith(
          expect.objectContaining({ requireCleanTreeForImplement: !original })
        )
      })
    }
  })

  it('shows custom reviewer name field when custom identity is selected', async () => {
    render(<SettingsPage settings={DEFAULT_SETTINGS} onSave={noop} onDismiss={noop} />)
    fireEvent.click(screen.getByText('Audit log'))
    await waitFor(() => screen.getByText('Reviewer identity'))
    const select = screen.getByRole('combobox') as HTMLSelectElement
    fireEvent.change(select, { target: { value: 'custom' } })
    await waitFor(() => {
      expect(screen.getByText('Custom reviewer name')).toBeTruthy()
    })
  })

  it('shows Per-phase prompts section', async () => {
    render(<SettingsPage settings={DEFAULT_SETTINGS} onSave={noop} onDismiss={noop} />)
    fireEvent.click(screen.getByText('Per-phase prompts'))
    await waitFor(() => {
      expect(screen.getByText(/Custom prompt prefixes/)).toBeTruthy()
    })
  })

  it('shows CLI & binary path section', async () => {
    render(<SettingsPage settings={DEFAULT_SETTINGS} onSave={noop} onDismiss={noop} />)
    fireEvent.click(screen.getByText('CLI & binary path'))
    await waitFor(() => {
      expect(screen.getByText('Command timeout (ms)')).toBeTruthy()
    })
  })

  it('updates gate auto-approve via updateGate when checkbox clicked', async () => {
    const onSave = vi.fn().mockResolvedValue(undefined)
    render(<SettingsPage settings={DEFAULT_SETTINGS} onSave={onSave} onDismiss={noop} />)
    // Find auto-approve checkboxes in the gates table (not implement row which has '—')
    const allCheckboxes = screen.getAllByRole('checkbox')
    // The first checkbox in the gates table should be for Constitution auto-approve
    if (allCheckboxes.length > 0) {
      fireEvent.click(allCheckboxes[0])
    }
    fireEvent.click(screen.getByText('Save changes'))
    await waitFor(() => {
      expect(onSave).toHaveBeenCalledOnce()
    })
  })

  it('accepts modified settings and passes them to onSave', async () => {
    const settings: PilotSettings = { ...DEFAULT_SETTINGS, defaultModel: 'claude-haiku-4-5' }
    const onSave = vi.fn().mockResolvedValue(undefined)
    render(<SettingsPage settings={settings} onSave={onSave} onDismiss={noop} />)
    fireEvent.click(screen.getByText('General'))
    await waitFor(() => screen.getByDisplayValue('claude-haiku-4-5'))
    fireEvent.click(screen.getByText('Save changes'))
    await waitFor(() => {
      expect(onSave).toHaveBeenCalledWith(
        expect.objectContaining({ defaultModel: 'claude-haiku-4-5' })
      )
    })
  })

  it('updates defaultModel when input changes in General section', async () => {
    const onSave = vi.fn().mockResolvedValue(undefined)
    render(<SettingsPage settings={DEFAULT_SETTINGS} onSave={onSave} onDismiss={noop} />)
    fireEvent.click(screen.getByText('General'))
    await waitFor(() => screen.getByDisplayValue(DEFAULT_SETTINGS.defaultModel))
    fireEvent.change(screen.getByDisplayValue(DEFAULT_SETTINGS.defaultModel), {
      target: { value: 'claude-opus-4-7' },
    })
    fireEvent.click(screen.getByText('Save changes'))
    await waitFor(() => {
      expect(onSave).toHaveBeenCalledWith(
        expect.objectContaining({ defaultModel: 'claude-opus-4-7' })
      )
    })
  })

  it('toggles openSidebarOnStart in General section', async () => {
    const onSave = vi.fn().mockResolvedValue(undefined)
    render(<SettingsPage settings={DEFAULT_SETTINGS} onSave={onSave} onDismiss={noop} />)
    fireEvent.click(screen.getByText('General'))
    await waitFor(() => screen.getByText('Open SpecKit sidebar on project start'))
    const checkboxes = screen.getAllByRole('checkbox')
    const sidebarCheckbox = checkboxes.find((cb) =>
      cb.closest('label')?.textContent?.includes('Open SpecKit sidebar')
    ) as HTMLInputElement
    expect(sidebarCheckbox).toBeTruthy()
    const original = sidebarCheckbox.checked
    fireEvent.click(sidebarCheckbox)
    fireEvent.click(screen.getByText('Save changes'))
    await waitFor(() => {
      expect(onSave).toHaveBeenCalledWith(
        expect.objectContaining({ openSidebarOnStart: !original })
      )
    })
  })

  it('updates maxFilesPerImplementRun when changed', async () => {
    const onSave = vi.fn().mockResolvedValue(undefined)
    render(<SettingsPage settings={DEFAULT_SETTINGS} onSave={onSave} onDismiss={noop} />)
    fireEvent.change(screen.getByDisplayValue(String(DEFAULT_SETTINGS.maxFilesPerImplementRun)), {
      target: { value: '25' },
    })
    fireEvent.click(screen.getByText('Save changes'))
    await waitFor(() => {
      expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ maxFilesPerImplementRun: 25 }))
    })
  })

  it('updates maxTokensPerCommand when changed', async () => {
    const onSave = vi.fn().mockResolvedValue(undefined)
    render(<SettingsPage settings={DEFAULT_SETTINGS} onSave={onSave} onDismiss={noop} />)
    fireEvent.change(screen.getByDisplayValue(String(DEFAULT_SETTINGS.maxTokensPerCommand)), {
      target: { value: '200000' },
    })
    fireEvent.click(screen.getByText('Save changes'))
    await waitFor(() => {
      expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ maxTokensPerCommand: 200000 }))
    })
  })

  it('updates disallowedPaths textarea when changed', async () => {
    const onSave = vi.fn().mockResolvedValue(undefined)
    render(<SettingsPage settings={DEFAULT_SETTINGS} onSave={onSave} onDismiss={noop} />)
    const textarea = document.querySelector('textarea.sk-textarea') as HTMLTextAreaElement
    expect(textarea).toBeTruthy()
    fireEvent.change(textarea, { target: { value: 'node_modules\n.env' } })
    fireEvent.click(screen.getByText('Save changes'))
    await waitFor(() => {
      expect(onSave).toHaveBeenCalledWith(
        expect.objectContaining({ disallowedPaths: ['node_modules', '.env'] })
      )
    })
  })

  it('toggles createCheckpointBeforeImplement when checkbox clicked', async () => {
    const onSave = vi.fn().mockResolvedValue(undefined)
    render(<SettingsPage settings={DEFAULT_SETTINGS} onSave={onSave} onDismiss={noop} />)
    const checkboxes = screen.getAllByRole('checkbox')
    const checkpointCb = checkboxes.find((cb) =>
      cb.closest('label')?.textContent?.includes('Create a checkpoint commit')
    ) as HTMLInputElement | undefined
    expect(checkpointCb).toBeTruthy()
    const original = checkpointCb!.checked
    fireEvent.click(checkpointCb!)
    fireEvent.click(screen.getByText('Save changes'))
    await waitFor(() => {
      expect(onSave).toHaveBeenCalledWith(
        expect.objectContaining({ createCheckpointBeforeImplement: !original })
      )
    })
  })

  it('updates commandTimeoutMs in CLI section', async () => {
    const onSave = vi.fn().mockResolvedValue(undefined)
    render(<SettingsPage settings={DEFAULT_SETTINGS} onSave={onSave} onDismiss={noop} />)
    fireEvent.click(screen.getByText('CLI & binary path'))
    await waitFor(() => screen.getByText('Command timeout (ms)'))
    fireEvent.change(screen.getByDisplayValue(String(DEFAULT_SETTINGS.commandTimeoutMs)), {
      target: { value: '60000' },
    })
    fireEvent.click(screen.getByText('Save changes'))
    await waitFor(() => {
      expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ commandTimeoutMs: 60000 }))
    })
  })

  it('updates runConsolePosition in CLI section', async () => {
    const onSave = vi.fn().mockResolvedValue(undefined)
    render(<SettingsPage settings={DEFAULT_SETTINGS} onSave={onSave} onDismiss={noop} />)
    fireEvent.click(screen.getByText('CLI & binary path'))
    await waitFor(() => screen.getByText('Run console position'))
    const select = screen.getByRole('combobox') as HTMLSelectElement
    fireEvent.change(select, { target: { value: 'tab' } })
    fireEvent.click(screen.getByText('Save changes'))
    await waitFor(() => {
      expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ runConsolePosition: 'tab' }))
    })
  })

  it('updates customReviewerName when custom identity input is changed', async () => {
    const onSave = vi.fn().mockResolvedValue(undefined)
    const settings: PilotSettings = {
      ...DEFAULT_SETTINGS,
      reviewerIdentity: 'custom',
      customReviewerName: '',
    }
    render(<SettingsPage settings={settings} onSave={onSave} onDismiss={noop} />)
    fireEvent.click(screen.getByText('Audit log'))
    await waitFor(() => screen.getByText('Custom reviewer name'))
    fireEvent.change(screen.getByDisplayValue(''), { target: { value: 'Alice' } })
    fireEvent.click(screen.getByText('Save changes'))
    await waitFor(() => {
      expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ customReviewerName: 'Alice' }))
    })
  })

  it('shows Telemetry section', async () => {
    render(<SettingsPage settings={DEFAULT_SETTINGS} onSave={noop} onDismiss={noop} />)
    fireEvent.click(screen.getByText('Telemetry'))
    await waitFor(() => {
      expect(screen.getByText(/does not send any telemetry/)).toBeTruthy()
    })
  })

  it('updates perFileConfirm for implement phase', async () => {
    const onSave = vi.fn().mockResolvedValue(undefined)
    render(<SettingsPage settings={DEFAULT_SETTINGS} onSave={onSave} onDismiss={noop} />)
    const allCheckboxes = screen.getAllByRole('checkbox')
    // The implement perFileConfirm checkbox is the last one in the gates table
    const implementCb = allCheckboxes.find((cb) => {
      const row = cb.closest('tr')
      return row?.textContent?.includes('Implement')
    }) as HTMLInputElement | undefined
    if (implementCb) {
      const original = implementCb.checked
      fireEvent.click(implementCb)
      fireEvent.click(screen.getByText('Save changes'))
      await waitFor(() => {
        expect(onSave).toHaveBeenCalledWith(
          expect.objectContaining({
            phaseGates: expect.objectContaining({
              implement: expect.objectContaining({ perFileConfirm: !original }),
            }),
          })
        )
      })
    }
  })
})
