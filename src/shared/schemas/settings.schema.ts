import { z } from 'zod'

export const ThemeSchema = z.enum(['dark', 'light'])

export const GlobalSettingsSchema = z.object({
  appearance: z.object({
    theme: ThemeSchema,
  }),
  terminal: z.object({
    scrollbackLimit: z.number().int().min(1000).max(100000),
    defaultShell: z.string().min(1),
    promptForName: z.boolean().default(false),
  }),
  git: z.object({
    worktreeBaseDir: z.string(),
    branchExcludePatterns: z.array(z.string()).default([]),
  }),
  extensions: z.record(z.string(), z.record(z.string(), z.unknown())),
  ui: z
    .object({
      hasSeenWelcome: z.boolean(),
    })
    .default({ hasSeenWelcome: false }),
})

export const WorkspaceSettingsSchema = z.object({
  workspaceId: z.string().uuid(),
  overrides: z
    .object({
      appearance: z
        .object({
          theme: ThemeSchema,
        })
        .optional(),
      terminal: z
        .object({
          scrollbackLimit: z.number().int().min(1000).max(100000).optional(),
          defaultShell: z.string().min(1).optional(),
        })
        .optional(),
      git: z
        .object({
          worktreeBaseDir: z.string().optional(),
          branchExcludePatterns: z.array(z.string()).optional(),
        })
        .optional(),
    })
    .optional()
    .default({}),
  extensions: z.record(z.string(), z.record(z.string(), z.unknown())).default({}),
})

export const DEFAULT_GLOBAL_SETTINGS = {
  appearance: { theme: 'dark' as const },
  terminal: {
    scrollbackLimit: 10000,
    defaultShell: process.env.SHELL || '/bin/zsh',
    promptForName: false,
  },
  git: { worktreeBaseDir: '', branchExcludePatterns: [] },
  extensions: {},
  ui: { hasSeenWelcome: false },
}

export type GlobalSettingsData = z.infer<typeof GlobalSettingsSchema>
export type WorkspaceSettingsData = z.infer<typeof WorkspaceSettingsSchema>
