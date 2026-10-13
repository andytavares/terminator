import React from 'react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { RemoteControlSettings } from '../../../src/components/RemoteControlSettings'

// The password is stored only as a hash, so this form can no longer show the
// current one. It sets a new one, or generates one and shows it once.

const invoke = vi.fn()

function settings(hasPassword: boolean) {
  return { enabled: false, port: 7681, maxSubscribers: 5, ngrokAuthToken: '', hasPassword }
}

function respond(hasPassword: boolean, updatePassword: unknown = { ok: true }) {
  invoke.mockImplementation((channel: string) =>
    Promise.resolve(channel === 'remote:update-password' ? updatePassword : settings(hasPassword))
  )
}

beforeEach(() => {
  invoke.mockReset()
  Object.defineProperty(window, 'electronAPI', {
    value: { extensionBridge: { on: () => () => {}, invoke } },
    configurable: true,
    writable: true,
  })
  Object.assign(navigator, { clipboard: { writeText: vi.fn() } })
})

describe('RemoteControlSettings password', settingsPasswordTests)

function settingsPasswordTests() {
  describe('saying whether one is set', settingsPasswordStateTests)
  describe('setting a typed password', settingsPasswordSetTests)
  describe('not sending a password', settingsPasswordWithholdTests)
  describe('generating one', settingsPasswordGenerateTests)
}

function settingsPasswordStateTests() {
  it('says whether a password is set without showing it', async () => {
    respond(true)
    render(<RemoteControlSettings />)
    await waitFor(() => expect(screen.getByText(/A password is set/)).toBeTruthy())
  })

  it('says none is set, so Remote Control cannot start yet', async () => {
    respond(false)
    render(<RemoteControlSettings />)
    await waitFor(() => expect(screen.getByText(/No password is set/)).toBeTruthy())
  })
}

function settingsPasswordSetTests() {
  it('sets the typed password on request and clears the field', async () => {
    respond(false)
    render(<RemoteControlSettings />)
    const field = await screen.findByPlaceholderText('New password')
    fireEvent.change(field, { target: { value: ' chosen-secret ' } })
    fireEvent.click(screen.getByRole('button', { name: 'Set password' }))
    await waitFor(() =>
      expect(invoke).toHaveBeenCalledWith('remote:update-password', { password: 'chosen-secret' })
    )
    await waitFor(() => expect((field as HTMLInputElement).value).toBe(''))
    expect(screen.queryByText('chosen-secret')).toBeNull()
  })
}

function settingsPasswordWithholdTests() {
  it('does not send a password merely because the field lost focus', async () => {
    respond(true)
    render(<RemoteControlSettings />)
    const field = await screen.findByPlaceholderText('New password')
    fireEvent.focus(field)
    fireEvent.blur(field)
    expect(invoke).not.toHaveBeenCalledWith('remote:update-password', expect.anything())
  })

  it('does not set an empty password', async () => {
    respond(true)
    render(<RemoteControlSettings />)
    await screen.findByPlaceholderText('New password')
    const button = screen.getByRole('button', { name: 'Set password' }) as HTMLButtonElement
    expect(button.disabled).toBe(true)
  })
}

function settingsPasswordGenerateTests() {
  it('shows a generated password once, with a warning that it cannot be shown again', async () => {
    respond(true, { password: 'generated-abc123' })
    render(<RemoteControlSettings />)
    await screen.findByPlaceholderText('New password')
    fireEvent.click(screen.getByRole('button', { name: 'Generate new' }))
    expect(await screen.findByText('generated-abc123')).toBeTruthy()
    expect(screen.getByText(/will not be shown again/)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Done' }))
    expect(screen.queryByText('generated-abc123')).toBeNull()
  })
}
