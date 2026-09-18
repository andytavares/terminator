import { describe, it, expect } from 'vitest'
import manifest from '../../manifest.json'

describe('git-integration manifest', () => {
  it('keeps the Git project tab', () => {
    expect(manifest.contributes.projectTab).toMatchObject({ label: 'Git', view: 'project' })
  })

  it('contributes no Git Changes side panel, nor a shortcut to toggle one', () => {
    expect(manifest.contributes).not.toHaveProperty('sidebarPanel')
    expect(manifest.contributes).not.toHaveProperty('commands')
  })
})
