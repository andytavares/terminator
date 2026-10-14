import { z } from 'zod'

// The closed sets the agent is shown in its prompt, rendered from these
// constants so the prompt and the parser can never disagree.
export const FINDING_SEVERITIES = ['must-fix', 'suggestion', 'nit', 'question'] as const
const AGENT_SCOPES = ['lines', 'hunk', 'file', 'chapter', 'pr'] as const
export const AGENT_REQUESTS = ['review', 'explain', 'ask'] as const

export const AgentScopeSchema = z.object({
  kind: z.enum(AGENT_SCOPES),
  path: z.string().nullable(),
  startLine: z.number().nullable(),
  endLine: z.number().nullable(),
  side: z.enum(['LEFT', 'RIGHT']).nullable(),
  /** The chapter's name, when kind is 'chapter'. */
  chapter: z.string().nullable(),
})

/** A chapter paragraph for PR scope: what changed, then what it affects. */
const WalkthroughEntrySchema = z.object({
  chapter: z.string(),
  text: z.string(),
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

export interface AgentFinding {
  id: string
  severity: FindingSeverity
  path: string
  startLine: number
  endLine: number
  side: 'LEFT' | 'RIGHT'
  title: string
  body: string
  suggestedCode: string | null
  dismissed: boolean
}

export type AgentScope = z.infer<typeof AgentScopeSchema>

export interface AgentRun {
  id: string
  repoRoot: string
  prNumber: number
  headSHA: string
  sessionId: string
  scope: AgentScope
  request: (typeof AGENT_REQUESTS)[number]
  question: string | null
  status: 'running' | 'done' | 'failed' | 'cancelled'
  startedAt: string
  finishedAt: string | null
  /** Last tool activity, e.g. "Read pr-review-service.ts", for the running state. */
  activity: string[]
  summary: string | null
  findings: AgentFinding[]
  walkthrough: z.infer<typeof WalkthroughEntrySchema>[]
  error: string | null
}

export type AgentOutput = z.infer<typeof AgentOutputSchema>
