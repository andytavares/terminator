import { describe, it, expect, beforeEach } from 'vitest'
import { useSessionStore } from '../../../../src/renderer/stores/session.store'
import type { TerminalInstance } from '../../../../src/renderer/components/terminal/TerminalSession'
import { exposeTerminalRows } from '../../../../src/renderer/terminal/terminal-rows'

function openTerminals(screens: Record<string, string[]>): void {
  const instances = Object.entries(screens).map(
    ([id, rows]) => [id, { readVisibleRows: () => rows } as unknown as TerminalInstance] as const
  )
  useSessionStore.setState({ terminalInstances: new Map(instances) })
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
})
