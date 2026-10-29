import { z } from 'zod'

export const FeatureIdSchema = z.string().regex(/^[a-z0-9][a-z0-9.:-]{0,119}$/)

export const ViaSchema = z.enum(['click', 'palette', 'shortcut', 'menu', 'remote', 'app', 'shown'])
export type Via = z.infer<typeof ViaSchema>

export const FeatureKindSchema = z.enum(['surface', 'action', 'command', 'control'])
export type FeatureKind = z.infer<typeof FeatureKindSchema>

/** `source` is 'core' or an extension id. */
export const FeatureDeclarationSchema = z.object({
  id: FeatureIdSchema,
  label: z.string().min(1).max(120),
  kind: FeatureKindSchema,
  source: z.string().min(1).max(120),
})
export type FeatureDeclaration = z.infer<typeof FeatureDeclarationSchema>

export const UsageRecordInputSchema = z.object({
  feature: FeatureIdSchema,
  via: ViaSchema,
  failed: z.boolean().optional(),
  activeMs: z.number().int().nonnegative().max(86_400_000).optional(),
  /** Lets a caller that knows the label declare an unknown id in the same call. */
  declare: FeatureDeclarationSchema.omit({ id: true }).optional(),
})

export const UsageDeclareInputSchema = z.object({
  features: z.array(FeatureDeclarationSchema).max(2000),
})

/** `from` is a local 'YYYY-MM-DD' day; null means all time. */
export const UsageReportInputSchema = z.object({
  from: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .nullable(),
})
