import { describe, it, expect, vi } from 'vitest'
import {
  buildSurfaceActions,
  findSurface,
  type SurfaceRegistration,
} from '../../../../src/renderer/quick-actions/surface-actions'
import type { QuickActionGroup } from '../../../../src/renderer/quick-actions/types'

const gitGroup: QuickActionGroup = { id: 'ext:git', mnemonic: 'g', label: 'Git', owner: 'git' }

function surface(overrides: Partial<SurfaceRegistration> = {}): SurfaceRegistration {
  return { extensionId: 'git', view: 'main', label: 'Git', kind: 'global', ...overrides }
}

describe('buildSurfaceActions', () => {
  it('gives the first surface of an extension mnemonic "o"', () => {
    const actions = buildSurfaceActions([surface()], vi.fn(), { groups: [gitGroup] })
    expect(actions[0]).toMatchObject({ label: 'Open Git', group: 'ext:git', mnemonic: 'o' })
  })

  it('gives a second surface of the same extension the first free letter of its label', () => {
    const surfaces = [
      surface({ view: 'main', label: 'Git' }),
      surface({ view: 'reviews', label: 'Reviews' }),
    ]
    const actions = buildSurfaceActions(surfaces, vi.fn(), { groups: [gitGroup] })
    expect(actions[1].mnemonic).toBe('r')
  })

  it('falls back to group "top" with no mnemonic when the extension has no allocated group', () => {
    const actions = buildSurfaceActions([surface({ extensionId: 'unmapped' })], vi.fn(), {
      groups: [gitGroup],
    })
    expect(actions[0].group).toBe('top')
    expect(actions[0].mnemonic).toBeUndefined()
  })
})

describe('buildSurfaceActions — never takes a letter another action in its group already uses', () => {
  it('never takes a letter another action in its group already uses', () => {
    const taken = [
      {
        id: 'ext:git.command.open',
        label: 'Open thing',
        group: 'ext:git',
        mnemonic: 'o',
        run: vi.fn(),
      },
      { id: 'ext:git.command.g', label: 'Go', group: 'ext:git', mnemonic: 'g', run: vi.fn() },
    ]
    const actions = buildSurfaceActions([surface({ label: 'Git' })], vi.fn(), {
      groups: [gitGroup],
      taken,
    })
    expect(actions[0].mnemonic).toBe('i')
  })

  it('activates the surface when run', async () => {
    const activate = vi.fn()
    const s = surface()
    const actions = buildSurfaceActions([s], activate, { groups: [gitGroup] })
    await actions[0].run()
    expect(activate).toHaveBeenCalledWith(s)
  })
})

describe('buildSurfaceActions — assigns no mnemonic once both "o" and every label letter are taken', () => {
  it('assigns no mnemonic once both "o" and every label letter are taken', () => {
    const surfaces = [
      surface({ view: 'a', label: 'Aa' }),
      surface({ view: 'b', label: 'Aa' }),
      surface({ view: 'c', label: 'Aa' }),
    ]
    const actions = buildSurfaceActions(surfaces, vi.fn(), { groups: [gitGroup] })
    expect(actions[0].mnemonic).toBe('o')
    expect(actions[1].mnemonic).toBe('a')
    expect(actions[2].mnemonic).toBeUndefined()
  })
})

describe('findSurface', () => {
  it('finds a registered surface by extension id and view', () => {
    const surfaces = [
      surface({ view: 'main' }),
      surface({ extensionId: 'notepad', view: 'sidebar' }),
    ]
    expect(findSurface(surfaces, 'notepad', 'sidebar')).toEqual(surfaces[1])
  })

  it('returns undefined when nothing matches', () => {
    expect(findSurface([surface()], 'notepad', 'sidebar')).toBeUndefined()
  })
})
