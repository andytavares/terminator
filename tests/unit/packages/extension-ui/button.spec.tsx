import React from 'react'
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { Check } from 'lucide-react'
import { Button } from '../../../../packages/extension-ui/src/Button'

describe('Button', () => {
  it('runs its handler when pressed', () => {
    const onClick = vi.fn()
    render(<Button onClick={onClick}>Save brief</Button>)
    fireEvent.click(screen.getByRole('button', { name: 'Save brief' }))
    expect(onClick).toHaveBeenCalledTimes(1)
  })

  it('does not run its handler while disabled, and says so to assistive technology', () => {
    const onClick = vi.fn()
    render(
      <Button disabled onClick={onClick}>
        Save brief
      </Button>
    )
    const button = screen.getByRole('button', { name: 'Save brief' })
    fireEvent.click(button)
    expect(onClick).not.toHaveBeenCalled()
    expect((button as HTMLButtonElement).disabled).toBe(true)
  })

  it('never submits a form it happens to sit in unless it is asked to', () => {
    const onSubmit = vi.fn((event: React.FormEvent) => event.preventDefault())
    render(
      <form onSubmit={onSubmit}>
        <Button>Cancel</Button>
        <Button type="submit">Save</Button>
      </form>
    )
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(onSubmit).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    expect(onSubmit).toHaveBeenCalledTimes(1)
  })

  it.each(['primary', 'secondary', 'ghost', 'danger'] as const)(
    'marks the %s variant for the stylesheet',
    (variant) => {
      render(<Button variant={variant}>Go</Button>)
      expect(screen.getByRole('button').className).toContain(`tmui-button--${variant}`)
    }
  )

  it('is secondary and medium when nothing else is asked for', () => {
    render(<Button>Go</Button>)
    const classes = screen.getByRole('button').className
    expect(classes).toContain('tmui-button--secondary')
    expect(classes).toContain('tmui-button--md')
  })

  it('marks the small size for the stylesheet', () => {
    render(<Button size="sm">Go</Button>)
    expect(screen.getByRole('button').className).toContain('tmui-button--sm')
  })

  it('draws an icon before the label, hidden from assistive technology and sized by CSS', () => {
    render(<Button icon={Check}>Done</Button>)
    const button = screen.getByRole('button', { name: 'Done' })
    const icon = button.querySelector('svg')
    expect(icon?.getAttribute('aria-hidden')).toBe('true')
    expect(icon?.getAttribute('class')).toContain('tmui-button__icon')
    expect(icon?.nextSibling?.textContent).toBe('Done')
  })

  it('passes accessibility attributes through', () => {
    render(
      <Button aria-pressed="true" title="Hint">
        Go
      </Button>
    )
    expect(screen.getByRole('button').getAttribute('aria-pressed')).toBe('true')
    expect(screen.getByRole('button').getAttribute('title')).toBe('Hint')
  })
})
