import { z } from 'zod'

const semverRegex = /^\d+\.\d+\.\d+$/
const semverRangeRegex = /^[>=^~\d].*$/

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
