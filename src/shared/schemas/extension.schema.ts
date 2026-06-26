import { z } from 'zod'

const semverRegex = /^\d+\.\d+\.\d+$/
const semverRangeRegex = /^[>=^~\d].*$/

const SurfaceContributionSchema = z.object({
  label: z.string().min(1).max(50),
  icon: z.string().optional(),
  view: z.string().optional(),
  defaultOpen: z.boolean().optional(),
})

export const ExtensionContributesSchema = z
  .object({
    globalTab: SurfaceContributionSchema.optional(),
    workspaceTab: SurfaceContributionSchema.optional(),
    projectTab: SurfaceContributionSchema.optional(),
    sidebarPanel: SurfaceContributionSchema.optional(),
    windowViews: z.array(z.object({ id: z.string().min(1), view: z.string().min(1) })).optional(),
    commands: z
      .array(
        z.object({
          id: z.string().min(1),
          label: z.string().min(1),
          shortcut: z.string().optional(),
          description: z.string().optional(),
        })
      )
      .optional(),
  })
  .passthrough()
  .transform((data) => {
    const { globalTab, workspaceTab, projectTab, sidebarPanel, windowViews, commands } = data
    return { globalTab, workspaceTab, projectTab, sidebarPanel, windowViews, commands }
  })

export type ExtensionContributes = z.infer<typeof ExtensionContributesSchema>

export const ExtensionManifestSchema = z.object({
  id: z
    .string()
    .min(1)
    .regex(/^[a-z0-9]+(\.[a-z0-9-]+)+$/, 'ID must be a reverse-domain identifier'),
  name: z.string().min(1).max(100),
  version: z.string().regex(semverRegex, 'Version must be a valid semver string (X.Y.Z)'),
  description: z.string().min(1),
  main: z.string().min(1),
  renderer: z.string().optional(),
  minAppVersion: z.string().regex(semverRangeRegex, 'minAppVersion must be a valid semver range'),
  contributes: ExtensionContributesSchema.optional(),
})

export const ExtensionSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  version: z.string(),
  description: z.string(),
  entryPoint: z.string(),
  status: z.enum(['enabled', 'disabled', 'error']),
  installedAt: z.string().datetime(),
  errorMessage: z.string().optional(),
})

export type ExtensionManifestData = z.infer<typeof ExtensionManifestSchema>
