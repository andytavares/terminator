import { describe, it, expect } from 'vitest'
import { ExtensionContributesSchema } from '../../../src/shared/schemas/extension.schema'

describe('ExtensionContributesSchema', () => {
  it('accepts an empty object (all fields optional)', () => {
    expect(ExtensionContributesSchema.safeParse({}).success).toBe(true)
  })

  it('accepts a valid globalTab contribution', () => {
    const result = ExtensionContributesSchema.safeParse({
      globalTab: { label: 'My Tool', icon: 'wrench', view: 'main' },
    })
    expect(result.success).toBe(true)
  })

  it('accepts globalTab without icon or view', () => {
    const result = ExtensionContributesSchema.safeParse({
      globalTab: { label: 'My Tool' },
    })
    expect(result.success).toBe(true)
  })

  it('rejects globalTab with label exceeding 50 chars', () => {
    const result = ExtensionContributesSchema.safeParse({
      globalTab: { label: 'A'.repeat(51) },
    })
    expect(result.success).toBe(false)
  })

  it('accepts a valid workspaceTab contribution', () => {
    const result = ExtensionContributesSchema.safeParse({
      workspaceTab: { label: 'Reviews', icon: 'git-pull-request', view: 'reviews' },
    })
    expect(result.success).toBe(true)
  })

  it('accepts a valid projectTab contribution', () => {
    const result = ExtensionContributesSchema.safeParse({
      projectTab: { label: 'Git', view: 'project' },
    })
    expect(result.success).toBe(true)
  })

  it('accepts a valid sidebarPanel contribution', () => {
    const result = ExtensionContributesSchema.safeParse({
      sidebarPanel: { label: 'Git Changes', defaultOpen: true, view: 'sidebar' },
    })
    expect(result.success).toBe(true)
  })

  it('accepts sidebarPanel with defaultOpen defaulting to false', () => {
    const result = ExtensionContributesSchema.safeParse({
      sidebarPanel: { label: 'Panel' },
    })
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.sidebarPanel?.defaultOpen).toBeUndefined()
    }
  })

  it('accepts windowViews array', () => {
    const result = ExtensionContributesSchema.safeParse({
      windowViews: [{ id: 'my-view', view: 'detail' }],
    })
    expect(result.success).toBe(true)
  })

  it('accepts commands array with shortcut', () => {
    const result = ExtensionContributesSchema.safeParse({
      commands: [
        {
          id: 'my-tool:open',
          label: 'Open My Tool',
          shortcut: 'CmdOrCtrl+Shift+M',
          description: 'Opens My Tool panel',
        },
      ],
    })
    expect(result.success).toBe(true)
  })

  it('accepts commands without shortcut or description', () => {
    const result = ExtensionContributesSchema.safeParse({
      commands: [{ id: 'my-tool:open', label: 'Open My Tool' }],
    })
    expect(result.success).toBe(true)
  })

  it('silently ignores unknown keys', () => {
    const result = ExtensionContributesSchema.safeParse({
      unknownFutureContribution: { label: 'something' },
      globalTab: { label: 'Known' },
    })
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data).not.toHaveProperty('unknownFutureContribution')
    }
  })

  it('accepts all contribution types together', () => {
    const full = {
      globalTab: { label: 'My Tool', icon: 'wrench', view: 'main' },
      workspaceTab: { label: 'My WS', icon: 'layers', view: 'ws' },
      projectTab: { label: 'My Proj', view: 'proj' },
      sidebarPanel: { label: 'My Panel', defaultOpen: false, view: 'panel' },
      windowViews: [{ id: 'detail', view: 'detail' }],
      commands: [{ id: 'my-tool:open', label: 'Open', shortcut: 'CmdOrCtrl+M' }],
    }
    expect(ExtensionContributesSchema.safeParse(full).success).toBe(true)
  })
})
