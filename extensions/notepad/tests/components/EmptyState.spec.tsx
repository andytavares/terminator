import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import React from 'react'
import { EmptyState } from '../../src/components/EmptyState'

describe('EmptyState', () => {
  it('renders "No notes yet" heading', () => {
    render(<EmptyState />)
    expect(screen.getByText('No notes yet')).toBeDefined()
  })

  it('renders description text', () => {
    render(<EmptyState />)
    expect(screen.getByText(/Capture your first note/i)).toBeDefined()
  })

  it('renders tip text', () => {
    render(<EmptyState />)
    expect(screen.getByText(/Tip:/i)).toBeDefined()
  })

  it('renders New note button', () => {
    render(<EmptyState />)
    expect(screen.getByText(/New note/i)).toBeDefined()
  })

  it('calls onNewNote when New note button is clicked', () => {
    const onNewNote = vi.fn()
    render(<EmptyState onNewNote={onNewNote} />)
    fireEvent.click(screen.getByText(/New note/i))
    expect(onNewNote).toHaveBeenCalledOnce()
  })

  it('renders Import button when onImport is provided', () => {
    render(<EmptyState onImport={vi.fn()} />)
    expect(screen.getByText(/Import a folder/i)).toBeDefined()
  })

  it('does not render Import button without onImport prop', () => {
    render(<EmptyState />)
    expect(screen.queryByText(/Import a folder/i)).toBeNull()
  })

  it('calls onImport when Import button is clicked', () => {
    const onImport = vi.fn()
    render(<EmptyState onImport={onImport} />)
    fireEvent.click(screen.getByText(/Import a folder/i))
    expect(onImport).toHaveBeenCalledOnce()
  })

  it('renders pencil emoji icon', () => {
    render(<EmptyState />)
    expect(screen.getByRole('img', { name: 'pencil' })).toBeDefined()
  })
})
