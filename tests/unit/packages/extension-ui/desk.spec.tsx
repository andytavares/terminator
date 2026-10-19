import React from 'react'
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent, within } from '@testing-library/react'
import { Kbd } from '../../../../packages/extension-ui/src/Kbd'
import { StatusDot } from '../../../../packages/extension-ui/src/StatusDot'
import { Chip } from '../../../../packages/extension-ui/src/Chip'
import { StageBar } from '../../../../packages/extension-ui/src/StageBar'
import { Sparkline, sparklinePoints } from '../../../../packages/extension-ui/src/Sparkline'
import { MetricCard } from '../../../../packages/extension-ui/src/MetricCard'
import { Drawer } from '../../../../packages/extension-ui/src/Drawer'
import { Checkbox } from '../../../../packages/extension-ui/src/Checkbox'

describe('Kbd', () => {
  it('shows the key as a keyboard element', () => {
    render(<Kbd>⌘P</Kbd>)
    expect(screen.getByText('⌘P').tagName).toBe('KBD')
  })
})

describe('StatusDot', () => {
  it('is announced by its label when it has one', () => {
    render(<StatusDot tone="waiting" label="Waiting for you" />)
    expect(screen.getByRole('img', { name: 'Waiting for you' })).toBeTruthy()
  })

  it('is hidden from assistive technology without a label', () => {
    const { container } = render(<StatusDot tone="good" />)
    expect(screen.queryByRole('img')).toBeNull()
    expect(container.firstElementChild?.getAttribute('aria-hidden')).toBe('true')
  })

  it('draws the ring only when asked', () => {
    const { container, rerender } = render(<StatusDot tone="working" />)
    expect(container.firstElementChild?.classList.contains('tmui-status-dot--pulse')).toBe(false)
    rerender(<StatusDot tone="working" pulse />)
    expect(container.firstElementChild?.classList.contains('tmui-status-dot--pulse')).toBe(true)
  })
})

describe('Chip', () => {
  it('shows its icon before its text', () => {
    render(<Chip icon={<svg data-testid="icon" />}>Checks passing</Chip>)
    const chip = screen.getByText('Checks passing')
    expect(chip.firstElementChild).toBe(screen.getByTestId('icon'))
  })

  it('takes the tone it is given', () => {
    render(<Chip tone="bad">Failed</Chip>)
    expect(screen.getByText('Failed').classList.contains('tmui-chip--bad')).toBe(true)
  })
})

describe('StageBar', () => {
  const stageNamed = (name: string): HTMLElement =>
    screen.getByText(name, { selector: '.tmui-stage-bar__name' }).closest('li') as HTMLElement

  it('marks the stage the work is at as current and tells screen readers its name', () => {
    render(<StageBar stage="in-review" />)
    const current = screen.getAllByRole('listitem').filter((li) => li.getAttribute('aria-current'))
    expect(current).toHaveLength(1)
    expect(current[0].textContent).toBe('In review')
  })

  it('marks earlier stages done and later ones upcoming', () => {
    render(<StageBar stage="building" />)
    expect(stageNamed('Shaping').dataset.state).toBe('done')
    expect(stageNamed('Building').dataset.state).toBe('current')
    expect(stageNamed('Merging').dataset.state).toBe('upcoming')
    expect(stageNamed('Shipped').dataset.state).toBe('upcoming')
  })

  it('marks a bar waiting on the reader', () => {
    render(<StageBar stage="in-review" yourMove />)
    expect(screen.getByRole('list').classList.contains('tmui-stage-bar--your-move')).toBe(true)
  })

  it('shows a caption under the compact bar only', () => {
    const { rerender } = render(<StageBar stage="building" caption="Waiting on your review" />)
    expect(screen.getByText('Waiting on your review')).toBeTruthy()
    rerender(<StageBar stage="building" size="large" caption="Waiting on your review" />)
    expect(screen.queryByText('Waiting on your review')).toBeNull()
  })
})

describe('Sparkline', () => {
  const endpoint = (container: HTMLElement): SVGCircleElement =>
    container.querySelector('circle[data-endpoint]') as SVGCircleElement

  it('puts the highest value at the top and the lowest at the bottom of one scale', () => {
    const points = sparklinePoints([5, 10, 0], 'md')
    expect(points[1].y).toBeLessThan(points[0].y)
    expect(points[0].y).toBeLessThan(points[2].y)
    expect(points[0].x).toBe(0)
    expect(points[2].x).toBe(200)
  })

  it('places the endpoint at the last value', () => {
    const { container } = render(<Sparkline values={[1, 4, 2]} />)
    const last = sparklinePoints([1, 4, 2], 'md')[2]
    expect(Number(endpoint(container).getAttribute('cy'))).toBe(last.y)
    expect(Number(endpoint(container).getAttribute('cx'))).toBeCloseTo(last.x - 2)
  })

  it('draws a flat series in the middle and a single value without failing', () => {
    expect(sparklinePoints([3, 3, 3], 'sm').map((point) => point.y)).toEqual([11, 11, 11])
    const { container } = render(<Sparkline values={[7]} />)
    expect(endpoint(container)).toBeTruthy()
  })
})

describe('Sparkline — drawing', () => {
  it('is a smaller drawing in the small size', () => {
    const { container } = render(<Sparkline values={[1, 2]} size="sm" />)
    expect(container.querySelector('svg')?.getAttribute('viewBox')).toBe('0 0 200 22')
  })

  it('draws nothing for no values and names itself only when labelled', () => {
    const { container, rerender } = render(<Sparkline values={[]} />)
    expect(container.querySelector('svg')).toBeNull()
    rerender(<Sparkline values={[1, 2]} label="Merged per week" />)
    expect(screen.getByRole('img', { name: 'Merged per week' })).toBeTruthy()
  })
})

describe('MetricCard', () => {
  it('shows the question, its qualifier, the value with its unit, and the sub line', () => {
    render(
      <MetricCard
        question="Time in review"
        qualifier="median"
        value="4.2"
        unit="h"
        sub="down 12%"
      />
    )
    expect(screen.getByText('Time in review').textContent).toContain('median')
    expect(screen.getByText('4.2').textContent).toBe('4.2h')
    expect(screen.getByText('down 12%')).toBeTruthy()
  })

  it('shows what it is given under the sub line', () => {
    render(
      <MetricCard question="Merged" value="12">
        <p>chart here</p>
      </MetricCard>
    )
    expect(screen.getByText('chart here')).toBeTruthy()
  })
})

describe('Drawer', () => {
  it('is a named dialog holding its content, open', () => {
    render(
      <Drawer label="Fix the login redirect" onDismiss={vi.fn()}>
        <p>Timeline</p>
      </Drawer>
    )
    const dialog = screen.getByRole('dialog', { name: 'Fix the login redirect' })
    expect(within(dialog).getByText('Timeline')).toBeTruthy()
    expect(dialog.hasAttribute('open')).toBe(true)
  })

  it('closes on Escape', () => {
    const onDismiss = vi.fn()
    render(
      <Drawer label="Fix the login redirect" onDismiss={onDismiss}>
        <p>Timeline</p>
      </Drawer>
    )
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(onDismiss).toHaveBeenCalledTimes(1)
  })

  it('takes focus on open', () => {
    render(
      <Drawer label="Fix the login redirect" onDismiss={vi.fn()}>
        <p>Timeline</p>
      </Drawer>
    )
    expect(screen.getByRole('dialog').contains(document.activeElement)).toBe(true)
  })
})

describe('Drawer — focus', () => {
  it('leaves focus on a field inside that asked for it', () => {
    render(
      <Drawer label="Reply" onDismiss={vi.fn()}>
        <input aria-label="Message" autoFocus />
      </Drawer>
    )
    expect(document.activeElement).toBe(screen.getByRole('textbox', { name: 'Message' }))
  })
})

describe('Checkbox', () => {
  it('reports the opposite state when pressed', () => {
    const onChange = vi.fn()
    render(<Checkbox checked={false} label="Tests pass" onChange={onChange} />)
    fireEvent.click(screen.getByRole('checkbox', { name: 'Tests pass' }))
    expect(onChange).toHaveBeenCalledWith(true)
  })

  it('shows a tick only when checked', () => {
    const { container, rerender } = render(<Checkbox checked label="Tests pass" />)
    expect(screen.getByRole('checkbox', { name: 'Tests pass' }).getAttribute('aria-checked')).toBe(
      'true'
    )
    expect(container.querySelector('svg')).toBeTruthy()
    rerender(<Checkbox checked={false} label="Tests pass" />)
    expect(container.querySelector('svg')).toBeNull()
  })

  it('cannot be pressed without a handler', () => {
    render(<Checkbox checked label="Tests pass" />)
    expect(screen.getByRole('checkbox').tagName).toBe('SPAN')
  })
})
