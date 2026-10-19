import { describe, it, expect } from 'vitest'
import { deskKeyCommand } from '../../../../src/renderer/components/home/use-desk-keys'

const key = (k: string, extra: Partial<KeyboardEvent> = {}) => ({
  key: k,
  metaKey: false,
  ctrlKey: false,
  altKey: false,
  ...extra,
})

describe('deskKeyCommand', () => {
  it.each([
    ['j', { kind: 'move', step: 1 }],
    ['k', { kind: 'move', step: -1 }],
    ['Enter', { kind: 'open' }],
    ['3', { kind: 'choose', number: 3 }],
    ['r', { kind: 'reply' }],
    ['e', { kind: 'done' }],
    ['h', { kind: 'snooze' }],
    ['t', { kind: 'terminal' }],
    ['Escape', { kind: 'escape' }],
  ])('reads %s', (pressed, command) => {
    expect(deskKeyCommand(key(pressed), false)).toEqual(command)
  })

  it('reads G then I as Insights and G then D as the Desk', () => {
    expect(deskKeyCommand(key('g'), false)).toEqual({ kind: 'go-to' })
    expect(deskKeyCommand(key('i'), true)).toEqual({ kind: 'view', view: 'insights' })
    expect(deskKeyCommand(key('d'), true)).toEqual({ kind: 'view', view: 'desk' })
  })

  it('ignores a key that is not one of the Desk keys, and 0', () => {
    expect(deskKeyCommand(key('x'), false)).toBeNull()
    expect(deskKeyCommand(key('0'), false)).toBeNull()
  })

  it('leaves a key held with a modifier to the app', () => {
    expect(deskKeyCommand(key('e', { metaKey: true }), false)).toBeNull()
    expect(deskKeyCommand(key('j', { ctrlKey: true }), false)).toBeNull()
  })
})
