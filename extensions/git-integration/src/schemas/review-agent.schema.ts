import { z } from 'zod'

// The closed sets the agent is shown in its prompt, rendered from these
// constants so the prompt and the parser can never disagree.
export const FINDING_SEVERITIES = ['must-fix', 'suggestion', 'nit', 'question'] as const
export const AGENT_SCOPES = ['lines', 'hunk', 'file', 'chapter', 'pr'] as const
export const AGENT_REQUESTS = ['review', 'explain', 'ask'] as const

export const AgentFindingSchema = z.object({
  id: z.string(),
  severity: z.enum(FINDING_SEVERITIES),
  path: z.string(),
  startLine: z.number(),
  endLine: z.number(),
  side: z.enum(['LEFT', 'RIGHT']).default('RIGHT'),
  title: z.string(),
  body: z.string(),
  suggestedCode: z.string().nullable().default(null),
  dismissed: z.boolean().default(false),
})

export const AgentScopeSchema = z.object({
  kind: z.enum(AGENT_SCOPES),
  path: z.string().nullable(),
  startLine: z.number().nullable(),
  endLine: z.number().nullable(),
  side: z.enum(['LEFT', 'RIGHT']).nullable(),
  /** The chapter's name, when kind is 'chapter'. */
  chapter: z.string().nullable(),
})

export const AgentRunStatusSchema = z.enum(['running', 'done', 'failed', 'cancelled'])

/** A chapter paragraph for PR scope: what changed, then what it affects. */
export const WalkthroughEntrySchema = z.object({
  chapter: z.string(),
  text: z.string(),
})

export const AgentRunSchema = z.object({
  id: z.string(),
  repoRoot: z.string(),
  prNumber: z.number(),
  headSHA: z.string(),
  sessionId: z.string(),
  scope: AgentScopeSchema,
  request: z.enum(AGENT_REQUESTS),
  question: z.string().nullable(),
  status: AgentRunStatusSchema,
  startedAt: z.string(),
  finishedAt: z.string().nullable(),
  /** Last tool activity, e.g. "Read pr-review-service.ts", for the running state. */
  activity: z.array(z.string()).default([]),
  summary: z.string().nullable().default(null),
  findings: z.array(AgentFindingSchema).default([]),
  walkthrough: z.array(WalkthroughEntrySchema).default([]),
  error: z.string().nullable().default(null),
})

/** What the agent itself returns, before ids and bookkeeping are added. */
export const AgentOutputSchema = z.object({
  summary: z.string(),
  findings: z.array(
    z.object({
      severity: z.enum(FINDING_SEVERITIES),
      path: z.string(),
      startLine: z.number(),
      endLine: z.number(),
      side: z.enum(['LEFT', 'RIGHT']).optional(),
      title: z.string(),
      body: z.string(),
      suggestedCode: z.string().nullable().optional(),
    })
  ),
  walkthrough: z.array(WalkthroughEntrySchema).optional(),
})

export type FindingSeverity = (typeof FINDING_SEVERITIES)[number]
export type AgentFinding = z.infer<typeof AgentFindingSchema>
export type AgentScope = z.infer<typeof AgentScopeSchema>
export type AgentRun = z.infer<typeof AgentRunSchema>
export type AgentOutput = z.infer<typeof AgentOutputSchema>
export type WalkthroughEntry = z.infer<typeof WalkthroughEntrySchema>
