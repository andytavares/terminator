import React from 'react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { ExtensionFooter } from '../../../../src/renderer/components/sidebar/ExtensionFooter'
import type { SidebarButtonRegistration } from '../../../../src/renderer/extensions/registry'

const makeButton = (id: string, label: string, icon?: string): SidebarButtonRegistration => ({
  id,
  label,
  icon,
  action: vi.fn(),
})

beforeEach(() => {
  vi.clearAllMocks()
})

describe('ExtensionFooter', () => {
  it('renders nothing when buttons array is empty', () => {
    const { container } = render(<ExtensionFooter buttons={[]} />)
    expect(container.firstChild).toBeNull()
  })

  it('renders one button per entry in buttons', () => {
    const buttons = [makeButton('b1', 'Git'), makeButton('b2', 'Tasks')]
    render(<ExtensionFooter buttons={buttons} />)
    expect(screen.getByText('Git')).toBeTruthy()
    expect(screen.getByText('Tasks')).toBeTruthy()
  })

  it('calls button.action() when a button is clicked', () => {
    const action = vi.fn()
    const buttons = [{ ...makeButton('b1', 'Git'), action }]
    render(<ExtensionFooter buttons={buttons} />)
    fireEvent.click(screen.getByText('Git'))
    expect(action).toHaveBeenCalledOnce()
  })

  it('renders icon when button has one', () => {
    const buttons = [makeButton('b1', 'Git', '⑂')]
    const { container } = render(<ExtensionFooter buttons={buttons} />)
    expect(container.querySelector('.ext-btn__icon')).toBeTruthy()
    expect(container.querySelector('.ext-btn__icon')?.textContent).toBe('⑂')
  })

  it('has border-top separator container when non-empty', () => {
    const buttons = [makeButton('b1', 'Git')]
    const { container } = render(<ExtensionFooter buttons={buttons} />)
    expect(container.querySelector('.extension-footer')).toBeTruthy()
  })
})
