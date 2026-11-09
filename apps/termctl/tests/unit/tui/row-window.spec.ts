import { describe, expect, it } from 'vitest'
import { rowWindow } from '../../../src/tui/view'

describe('the rows a pane of fixed height shows', () => {
  it('starts at the top while the selected row fits', () => {
    expect(rowWindow({ selected: 3, count: 40, height: 10 })).toEqual({ start: 0, end: 10 })
  })

  it('scrolls so the selected row is the last one shown', () => {
    expect(rowWindow({ selected: 14, count: 40, height: 10 })).toEqual({ start: 5, end: 15 })
  })

  it('shows every row when the list is shorter than the pane', () => {
    expect(rowWindow({ selected: 2, count: 4, height: 10 })).toEqual({ start: 0, end: 4 })
  })

  it('shows one row when the terminal leaves no room', () => {
    expect(rowWindow({ selected: 7, count: 40, height: 0 })).toEqual({ start: 7, end: 8 })
  })
})
