export type VarName = 'cwd' | 'branch' | 'worktree' | 'repo' | 'issue' | 'selection'

const MISSING_REASON: Record<VarName, string> = {
  cwd: 'No working directory',
  branch: 'No branch focused',
  worktree: 'No worktree focused',
  repo: 'No repository focused',
  issue: 'No linked issue',
  selection: 'No text selected',
}

const KNOWN_NAMES = new Set<VarName>(Object.keys(MISSING_REASON) as VarName[])

export function expandVariables(
  body: string,
  vars: Partial<Record<VarName, string | null>>
): { ok: true; text: string } | { ok: false; reason: string } {
  let failure: { ok: false; reason: string } | null = null

  const text = body.replace(/\{([a-zA-Z]+)\}/g, (match, name: string) => {
    if (failure) return match
    if (!KNOWN_NAMES.has(name as VarName)) return match

    const value = vars[name as VarName]
    if (!value) {
      failure = { ok: false, reason: MISSING_REASON[name as VarName] }
      return match
    }
    return value
  })

  return failure ?? { ok: true, text }
}
