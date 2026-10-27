// Foundry's hard refusals, as Claude Code permission deny rules: deny rules are checked
// before any mode, so they hold in `auto` mode too, where the policy sees only what the
// classifier asks about (https://code.claude.com/docs/en/permissions).

/** The `gh pr` verbs that change a pull request; the line ships the branch itself. */
const PR_WRITES = [
  'checkout',
  'close',
  'comment',
  'create',
  'edit',
  'lock',
  'merge',
  'ready',
  'reopen',
  'review',
  'unlock',
  'update-branch',
]

/** The tools a role file can leave out; one it leaves out is removed from the agent. */
const RESTRICTABLE_TOOLS = [
  'Bash',
  'Edit',
  'MultiEdit',
  'Write',
  'NotebookEdit',
  'WebFetch',
  'WebSearch',
]

export interface DenyRuleFacts {
  /** The node's skills mount, read-only, or null when it has none. */
  readonly skillsMount: string | null
  readonly mayUseTool: (tool: string) => boolean
}

export function denyRules({ skillsMount, mayUseTool }: DenyRuleFacts): string[] {
  return [
    'Bash(git push)',
    'Bash(git push *)',
    ...PR_WRITES.map((verb) => `Bash(gh pr ${verb} *)`),
    // `//` is an absolute path in a rule; `Edit` covers every tool that edits.
    ...(skillsMount === null ? [] : [`Edit(/${skillsMount}/**)`]),
    ...RESTRICTABLE_TOOLS.filter((tool) => !mayUseTool(tool)),
  ]
}
