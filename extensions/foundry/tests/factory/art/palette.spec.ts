import { describe, it, expect } from 'vitest'
import { roleStyle } from '../../../src/factory/art/palette.js'

describe('factory/art/palette roleStyle', () => {
  it('gives the builder a hard hat and no visor', () => {
    const s = roleStyle('builder')
    expect(s.hat).not.toBeNull()
    expect(s.visor).toBe(false)
    expect(s.vest).toBe(false)
  })

  it('gives the foreman a hi-vis vest and a white hat', () => {
    const s = roleStyle('foreman')
    expect(s.vest).toBe(true)
    expect(s.hat).not.toBeNull()
  })

  it('gives verifier and inspector a visor but distinct shirts', () => {
    const verifier = roleStyle('verifier')
    const inspector = roleStyle('inspector')
    expect(verifier.visor).toBe(true)
    expect(inspector.visor).toBe(true)
    expect(verifier.shirt).not.toBe(inspector.shirt)
  })

  it('gives architect, author, scribe and scout distinct hair and shirts', () => {
    const roles = ['architect', 'author', 'scribe', 'scout'] as const
    const styles = roles.map(roleStyle)
    const shirts = new Set(styles.map((s) => s.shirt))
    const hairs = new Set(styles.map((s) => s.hair))
    expect(shirts.size).toBe(roles.length)
    expect(hairs.size).toBe(roles.length)
  })

  it('falls back to a neutral silhouette for an unknown role', () => {
    const known = [
      'builder',
      'foreman',
      'verifier',
      'inspector',
      'architect',
      'author',
      'scribe',
      'scout',
    ]
    const unknown = roleStyle('integrator')
    const none = roleStyle(null)
    expect(unknown).toEqual(none)
    expect(known).not.toContain('integrator')
  })

  it('is deterministic for the same role', () => {
    expect(roleStyle('builder')).toEqual(roleStyle('builder'))
  })
})
