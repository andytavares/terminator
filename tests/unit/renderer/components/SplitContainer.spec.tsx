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

  it('applies complementary ratio to second child', () => {
    const { container } = renderSplit('vertical', 0.3)
    const children = container.querySelectorAll('.split-container__child')
    expect(parseFloat((children[1] as HTMLElement).style.flex)).toBeCloseTo(0.7)
  })

  it('calls onRatioChange on mouse drag', () => {
    const onRatioChange = vi.fn()
    const { container } = render(
      <SplitContainer
        splitId="split-1"
        direction="vertical"
        ratio={0.5}
        onRatioChange={onRatioChange}
      >
        {[<div key="a">A</div>, <div key="b">B</div>]}
      </SplitContainer>
    )

    const divider = container.querySelector('.split-container__divider') as HTMLElement
    const outerContainer = container.querySelector('.split-container') as HTMLElement

    // Mock getBoundingClientRect
    outerContainer.getBoundingClientRect = vi.fn(() => ({
      left: 0,
      top: 0,
      width: 400,
      height: 200,
      right: 400,
      bottom: 200,
      x: 0,
      y: 0,
      toJSON: vi.fn(),
    }))

    fireEvent.mouseDown(divider, { clientX: 200, clientY: 100 })
    fireEvent.mouseMove(document, { clientX: 300, clientY: 100 })
    fireEvent.mouseUp(document)

    expect(onRatioChange).toHaveBeenCalled()
    const [splitId, ratio] = onRatioChange.mock.calls[0]
    expect(splitId).toBe('split-1')
    expect(ratio).toBeCloseTo(0.75)
  })

  it('clamps ratio to minimum 0.1', () => {
    const onRatioChange = vi.fn()
    const { container } = render(
      <SplitContainer
        splitId="split-1"
        direction="vertical"
        ratio={0.5}
        onRatioChange={onRatioChange}
      >
        {[<div key="a">A</div>, <div key="b">B</div>]}
      </SplitContainer>
    )

    const divider = container.querySelector('.split-container__divider') as HTMLElement
    const outerContainer = container.querySelector('.split-container') as HTMLElement
    outerContainer.getBoundingClientRect = vi.fn(() => ({
      left: 0,
      top: 0,
      width: 400,
      height: 200,
      right: 400,
      bottom: 200,
      x: 0,
      y: 0,
      toJSON: vi.fn(),
    }))

    fireEvent.mouseDown(divider, { clientX: 200 })
    fireEvent.mouseMove(document, { clientX: -100 })
    fireEvent.mouseUp(document)

    const [, ratio] = onRatioChange.mock.calls[0]
    expect(ratio).toBe(0.1)
  })

  it('clamps ratio to maximum 0.9', () => {
    const onRatioChange = vi.fn()
    const { container } = render(
      <SplitContainer
        splitId="split-1"
        direction="vertical"
        ratio={0.5}
        onRatioChange={onRatioChange}
      >
        {[<div key="a">A</div>, <div key="b">B</div>]}
      </SplitContainer>
    )

    const divider = container.querySelector('.split-container__divider') as HTMLElement
    const outerContainer = container.querySelector('.split-container') as HTMLElement
    outerContainer.getBoundingClientRect = vi.fn(() => ({
      left: 0,
      top: 0,
      width: 400,
      height: 200,
      right: 400,
      bottom: 200,
      x: 0,
      y: 0,
      toJSON: vi.fn(),
    }))

    fireEvent.mouseDown(divider, { clientX: 200 })
    fireEvent.mouseMove(document, { clientX: 9999 })
    fireEvent.mouseUp(document)

    const [, ratio] = onRatioChange.mock.calls[0]
    expect(ratio).toBe(0.9)
  })

  it('calls onRatioChange using clientY for horizontal splits', () => {
    const onRatioChange = vi.fn()
    const { container } = render(
      <SplitContainer
        splitId="split-h"
        direction="horizontal"
        ratio={0.5}
        onRatioChange={onRatioChange}
      >
        {[<div key="a">A</div>, <div key="b">B</div>]}
      </SplitContainer>
    )

    const divider = container.querySelector('.split-container__divider') as HTMLElement
    const outerContainer = container.querySelector('.split-container') as HTMLElement
    outerContainer.getBoundingClientRect = vi.fn(() => ({
      left: 0,
      top: 0,
      width: 400,
      height: 400,
      right: 400,
      bottom: 400,
      x: 0,
      y: 0,
      toJSON: vi.fn(),
    }))

    fireEvent.mouseDown(divider, { clientY: 100 })
    fireEvent.mouseMove(document, { clientY: 200 })
    fireEvent.mouseUp(document)

    expect(onRatioChange).toHaveBeenCalled()
    const [splitId, ratio] = onRatioChange.mock.calls[0]
    expect(splitId).toBe('split-h')
    expect(ratio).toBeCloseTo(0.5)
  })

  it('does not call onRatioChange after mouseup', () => {
    const onRatioChange = vi.fn()
    const { container } = render(
      <SplitContainer
        splitId="split-1"
        direction="vertical"
        ratio={0.5}
        onRatioChange={onRatioChange}
      >
        {[<div key="a">A</div>, <div key="b">B</div>]}
      </SplitContainer>
    )

    const divider = container.querySelector('.split-container__divider') as HTMLElement
    const outerContainer = container.querySelector('.split-container') as HTMLElement
    outerContainer.getBoundingClientRect = vi.fn(() => ({
      left: 0,
      top: 0,
      width: 400,
      height: 200,
      right: 400,
      bottom: 200,
      x: 0,
      y: 0,
      toJSON: vi.fn(),
    }))

    fireEvent.mouseDown(divider, { clientX: 200 })
    fireEvent.mouseUp(document)
    onRatioChange.mockClear()
    fireEvent.mouseMove(document, { clientX: 300 })

    expect(onRatioChange).not.toHaveBeenCalled()
  })
})
