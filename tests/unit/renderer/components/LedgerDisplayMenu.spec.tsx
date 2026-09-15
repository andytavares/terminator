import React from 'react'
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { LedgerDisplayMenu } from '../../../../src/renderer/components/home/LedgerDisplayMenu'
import { DEFAULT_HOME_PREFS } from '../../../../src/renderer/sidebar/home-prefs'

function open(onChange = vi.fn(), prefs = DEFAULT_HOME_PREFS) {
  render(<LedgerDisplayMenu prefs={prefs} onChange={onChange} />)
  fireEvent.click(screen.getByRole('button', { name: 'Display' }))
  return onChange
}

describe('LedgerDisplayMenu', () => {
  it('is closed until asked', () => {
    render(<LedgerDisplayMenu prefs={DEFAULT_HOME_PREFS} onChange={vi.fn()} />)
    expect(screen.queryByRole('menu', { name: 'Display options' })).toBeNull()
    expect(screen.getByRole('button', { name: 'Display' }).getAttribute('aria-expanded')).toBe(
      'false'
    )
  })

  it('shows the current grouping, sort, columns and options', () => {
    open()
    expect(screen.getByRole('menu', { name: 'Display options' })).toBeTruthy()
    expect(
      screen.getByRole('menuitemradio', { name: 'Repo, then branch' }).getAttribute('aria-checked')
    ).toBe('true')
    expect(
      screen.getByRole('menuitemradio', { name: 'Needs you first' }).getAttribute('aria-checked')
    ).toBe('true')
    expect(
      screen.getByRole('menuitemcheckbox', { name: 'Tags' }).getAttribute('aria-checked')
    ).toBe('false')
    expect(
      screen.getByRole('menuitemcheckbox', { name: 'Latest output' }).getAttribute('aria-checked')
    ).toBe('true')
    expect(
      screen
        .getByRole('menuitemcheckbox', { name: 'Hide exited sessions' })
        .getAttribute('aria-checked')
    ).toBe('false')
  })

  it('changes grouping and sort, closing the menu', () => {
    const onChange = open()
    fireEvent.click(screen.getByRole('menuitemradio', { name: 'Branch' }))
    expect(onChange).toHaveBeenCalledWith({ groupBy: 'project' })
    expect(screen.queryByRole('menu')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Display' }))
    fireEvent.click(screen.getByRole('menuitemradio', { name: 'Recent activity' }))
    expect(onChange).toHaveBeenCalledWith({ sort: 'recent' })
  })

  it('toggles a column without closing, so several can be changed at once', () => {
    const onChange = open()
    fireEvent.click(screen.getByRole('menuitemcheckbox', { name: 'Latest output' }))
    expect(onChange).toHaveBeenCalledWith({
      columns: { ...DEFAULT_HOME_PREFS.columns, latestLine: false },
    })
    expect(screen.getByRole('menu')).toBeTruthy()
  })

  it('toggles the preview and exited options', () => {
    const onChange = open()
    fireEvent.click(screen.getByRole('menuitemcheckbox', { name: 'Preview the selected row' }))
    fireEvent.click(screen.getByRole('menuitemcheckbox', { name: 'Hide exited sessions' }))
    expect(onChange).toHaveBeenCalledWith({ previewSelected: false })
    expect(onChange).toHaveBeenCalledWith({ hideExited: true })
  })

  it('closes on a click anywhere else', () => {
    open()
    fireEvent.click(document.body)
    expect(screen.queryByRole('menu')).toBeNull()
  })

  it('closes when another menu opens', () => {
    open()
    fireEvent(window, new Event('close-context-menus'))
    expect(screen.queryByRole('menu')).toBeNull()
  })
})
