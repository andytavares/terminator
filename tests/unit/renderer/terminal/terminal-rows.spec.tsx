import { describe, it, expect, beforeEach } from 'vitest'
import { partialFake } from '../../../support/fakes'
import { useSessionStore } from '../../../../src/renderer/stores/session.store'
import type { TerminalInstance } from '../../../../src/renderer/components/terminal/TerminalSession'
import { exposeTerminalRows } from '../../../../src/renderer/terminal/terminal-rows'

/** Opens a terminal per entry, each with its own element, and returns the elements. */
function openTerminals(screens: Record<string, string[]>): HTMLElement[] {
  const instances = Object.entries(screens).map(([id, rows]) => {
    const element = document.createElement('div')
    element.appendChild(document.createElement('div')).className = 'xterm-screen'
    return [id, partialFake<TerminalInstance>({ element, readVisibleRows: () => rows })] as const
  })
  useSessionStore.setState({ terminalInstances: new Map(instances) })
  return instances.map(([, instance]) => instance.element)
}

beforeEach(() => {
  delete window.terminatorE2E
  openTerminals({})
})

describe('exposeTerminalRows', () => {
  it('reads what every open terminal shows, top to bottom', () => {
    openTerminals({ a: ['$ echo 4242', '4242'], b: ['$ '] })
    exposeTerminalRows()

    expect(window.terminatorE2E?.terminalRows()).toEqual(['$ echo 4242', '4242', '$ '])
  })

  it('reads a terminal opened after it was exposed', () => {
    exposeTerminalRows()
    openTerminals({ a: ['❯ 1. Yes'] })

    expect(window.terminatorE2E?.terminalRows()).toEqual(['❯ 1. Yes'])
  })

  it('reads the one terminal drawn in an element, when several are open', () => {
    const [, second] = openTerminals({ a: ['$ ls', 'a.txt'], b: ['$ echo hi', 'hi'] })
    exposeTerminalRows()

    const screen = second.querySelector('.xterm-screen')!
    expect(window.terminatorE2E?.terminalRowsIn(screen)).toEqual(['$ echo hi', 'hi'])
  })

  it('says when no open terminal draws in the element', () => {
    openTerminals({ a: ['$ '] })
    exposeTerminalRows()

    expect(() => window.terminatorE2E?.terminalRowsIn(document.createElement('div'))).toThrow(
      'no open terminal draws in this element'
    )
  })
})
