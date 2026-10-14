import { z } from 'zod'

const semverRegex = /^\d+\.\d+\.\d+$/
const semverRangeRegex = /^[>=^~\d].*$/

const SurfaceContributionSchema = z.object({
  label: z.string().min(1).max(50),
  icon: z.string().optional(),
  view: z.string().optional(),
  defaultOpen: z.boolean().optional(),
})

const QuickActionsGroupSchema = z.object({
  mnemonic: z.string().length(1).optional(),
  label: z.string().min(1),
})

/** @internal */
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
          mnemonic: z.string().length(1).optional(),
          requires: z.enum(['repo', 'session']).optional(),
        })
      )
      .optional(),
    quickActions: z.object({ group: QuickActionsGroupSchema.optional() }).optional(),
    /** The extension's own folder settings whose directories its git and gh may run in (ADR 102). */
    shellRoots: z.array(z.string().min(1)).optional(),
  })
  .passthrough()
  .transform((data) => {
    const {
      globalTab,
      workspaceTab,
      projectTab,
      sidebarPanel,
      windowViews,
      commands,
      quickActions,
      shellRoots,
    } = data
    return {
      globalTab,
      workspaceTab,
      projectTab,
      sidebarPanel,
      windowViews,
      commands,
      quickActions,
      shellRoots,
    }
  })

const ExtensionIdSchema = z
  .string()
  .min(1)
  .regex(/^[a-z0-9]+(\.[a-z0-9-]+)+$/, 'ID must be a reverse-domain identifier')

type ExtensionContributes = z.infer<typeof ExtensionContributesSchema>

/** A shell root names a setting in the extension's own namespace, `<id>.…`; no other extension's. */
function refuseForeignShellRoots(
  manifest: { id: string; contributes?: ExtensionContributes },
  context: z.RefinementCtx
): void {
  for (const key of manifest.contributes?.shellRoots ?? []) {
    if (key.startsWith(`${manifest.id}.`)) continue
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['contributes', 'shellRoots'],
      message: `Shell root "${key}" is not a setting of ${manifest.id}`,
    })
  }
}

export const ExtensionManifestSchema = z
  .object({
    id: ExtensionIdSchema,
    name: z.string().min(1).max(100),
    version: z.string().regex(semverRegex, 'Version must be a valid semver string (X.Y.Z)'),
    description: z.string().min(1),
    main: z.string().min(1),
    renderer: z.string().optional(),
    minAppVersion: z.string().regex(semverRangeRegex, 'minAppVersion must be a valid semver range'),
    contributes: ExtensionContributesSchema.optional(),
    /** Extensions activated before this one, whose `activate` exports it may read (ADR 094). */
    extensionDependencies: z.array(ExtensionIdSchema).optional(),
  })
  .superRefine(refuseForeignShellRoots)
