import React from 'react'
import { describe, it, expect, vi } from 'vitest'
import { render, fireEvent } from '@testing-library/react'
import { SplitContainer } from '../../../../src/renderer/components/terminal/SplitContainer'

function renderSplit(direction: 'horizontal' | 'vertical', ratio: number, onRatioChange = vi.fn()) {
  return render(
    <SplitContainer
      splitId="split-1"
      direction={direction}
      ratio={ratio}
      onRatioChange={onRatioChange}
    >
      {[
        <div key="a" data-testid="first">
          First
        </div>,
        <div key="b" data-testid="second">
          Second
        </div>,
      ]}
    </SplitContainer>
  )
}

/** A split laid out 400 by 200 at the origin; returns its divider. */
function renderDraggable(
  direction: 'horizontal' | 'vertical',
  onRatioChange: (splitId: string, ratio: number) => void,
  splitId = 'split-1'
): HTMLElement {
  const { container } = render(
    <SplitContainer
      splitId={splitId}
      direction={direction}
      ratio={0.5}
      onRatioChange={onRatioChange}
    >
      {[<div key="a">A</div>, <div key="b">B</div>]}
    </SplitContainer>
  )
  const outerContainer = container.querySelector('.split-container') as HTMLElement
  outerContainer.getBoundingClientRect = () =>
    DOMRect.fromRect({ x: 0, y: 0, width: 400, height: 200 })
  return container.querySelector('.split-container__divider') as HTMLElement
}

describe('SplitContainer', () => {
  it('renders both children', () => {
    const { getByTestId } = renderSplit('vertical', 0.5)
    expect(getByTestId('first')).toBeTruthy()
    expect(getByTestId('second')).toBeTruthy()
  })

  it('applies vertical direction class', () => {
    const { container } = renderSplit('vertical', 0.5)
    expect(container.querySelector('.split-container--vertical')).toBeTruthy()
  })

  it('applies horizontal direction class', () => {
    const { container } = renderSplit('horizontal', 0.5)
    expect(container.querySelector('.split-container--horizontal')).toBeTruthy()
  })

  it('renders a vertical divider for vertical splits', () => {
    const { container } = renderSplit('vertical', 0.5)
    expect(container.querySelector('.split-container__divider--vertical')).toBeTruthy()
  })

  it('renders a horizontal divider for horizontal splits', () => {
    const { container } = renderSplit('horizontal', 0.5)
    expect(container.querySelector('.split-container__divider--horizontal')).toBeTruthy()
  })

  it('applies ratio to flex style of first child', () => {
    const { container } = renderSplit('vertical', 0.3)
    const children = container.querySelectorAll('.split-container__child')
    expect(parseFloat((children[0] as HTMLElement).style.flex)).toBeCloseTo(0.3)
  })
})

describe('SplitContainer — applies complementary ratio to second child', () => {
  it('applies complementary ratio to second child', () => {
    const { container } = renderSplit('vertical', 0.3)
    const children = container.querySelectorAll('.split-container__child')
    expect(parseFloat((children[1] as HTMLElement).style.flex)).toBeCloseTo(0.7)
  })
})

describe('SplitContainer — calls onRatioChange on mouse drag', () => {
  it('calls onRatioChange on mouse drag', () => {
    const onRatioChange = vi.fn()
    const divider = renderDraggable('vertical', onRatioChange)

    fireEvent.mouseDown(divider, { clientX: 200, clientY: 100 })
    fireEvent.mouseMove(document, { clientX: 300, clientY: 100 })
    fireEvent.mouseUp(document)

    expect(onRatioChange).toHaveBeenCalled()
    const [splitId, ratio] = onRatioChange.mock.calls[0]
    expect(splitId).toBe('split-1')
    expect(ratio).toBeCloseTo(0.75)
  })
})

describe('SplitContainer — clamps ratio to minimum 0.1', () => {
  it('clamps ratio to minimum 0.1', () => {
    const onRatioChange = vi.fn()
    const divider = renderDraggable('vertical', onRatioChange)

    fireEvent.mouseDown(divider, { clientX: 200 })
    fireEvent.mouseMove(document, { clientX: -100 })
    fireEvent.mouseUp(document)

    const [, ratio] = onRatioChange.mock.calls[0]
    expect(ratio).toBe(0.1)
  })
})

describe('SplitContainer — clamps ratio to maximum 0.9', () => {
  it('clamps ratio to maximum 0.9', () => {
    const onRatioChange = vi.fn()
    const divider = renderDraggable('vertical', onRatioChange)

    fireEvent.mouseDown(divider, { clientX: 200 })
    fireEvent.mouseMove(document, { clientX: 9999 })
    fireEvent.mouseUp(document)

    const [, ratio] = onRatioChange.mock.calls[0]
    expect(ratio).toBe(0.9)
  })
})

describe('SplitContainer — calls onRatioChange using clientY for horizontal splits', () => {
  it('calls onRatioChange using clientY for horizontal splits', () => {
    const onRatioChange = vi.fn()
    // Half way down the 200px-high split.
    const divider = renderDraggable('horizontal', onRatioChange, 'split-h')
    fireEvent.mouseDown(divider, { clientY: 50 })
    fireEvent.mouseMove(document, { clientY: 100 })
    fireEvent.mouseUp(document)

    expect(onRatioChange).toHaveBeenCalled()
    const [splitId, ratio] = onRatioChange.mock.calls[0]
    expect(splitId).toBe('split-h')
    expect(ratio).toBeCloseTo(0.5)
  })
})

describe('SplitContainer — does not call onRatioChange after mouseup', () => {
  it('does not call onRatioChange after mouseup', () => {
    const onRatioChange = vi.fn()
    const divider = renderDraggable('vertical', onRatioChange)

    fireEvent.mouseDown(divider, { clientX: 200 })
    fireEvent.mouseUp(document)
    onRatioChange.mockClear()
    fireEvent.mouseMove(document, { clientX: 300 })

    expect(onRatioChange).not.toHaveBeenCalled()
  })
})
