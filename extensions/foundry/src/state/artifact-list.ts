import type { ArtifactRef, ArtifactRevision, ArtifactKind } from '../types/speckit.types.js'

/** Parse `git log --pretty=format:%h%x09%cI%x09%s -- <path>` output into revisions. */
export function parseGitLog(stdout: string): ArtifactRevision[] {
  const revisions: ArtifactRevision[] = []
  for (const line of stdout.split('\n')) {
    if (!line.trim()) continue
    const [commit, ts, ...rest] = line.split('\t')
    if (!commit) continue
    revisions.push({ commit, ts: ts ?? '', subject: rest.join('\t') })
  }
  return revisions
}

export interface ArtifactSpec {
  kind: ArtifactKind
  label: string
  relPath: string | null
}

/** The fixed set of artifacts a card can produce, in display order. */
export function artifactSpecs(): ArtifactSpec[] {
  return [
    { kind: 'spec', label: 'Specification', relPath: 'spec.md' },
    { kind: 'plan', label: 'Plan', relPath: 'plan.md' },
    { kind: 'tasks', label: 'Tasks', relPath: 'tasks.md' },
    { kind: 'checklist', label: 'Checklist', relPath: 'checklists/requirements.md' },
    { kind: 'self-review', label: 'Self-review', relPath: '.pilot/self-review.json' },
    { kind: 'diff', label: 'Code diff', relPath: null },
    { kind: 'pr', label: 'Pull request', relPath: null },
  ]
}

/** Build an ArtifactRef from a spec plus resolved existence/revisions/pr url. */
export function buildArtifactRef(
  spec: ArtifactSpec,
  opts: { exists: boolean; revisions: ArtifactRevision[]; prUrl?: string | null }
): ArtifactRef {
  return {
    kind: spec.kind,
    path: spec.relPath,
    label: spec.label,
    exists: spec.kind === 'pr' ? Boolean(opts.prUrl) : opts.exists,
    revisions: opts.revisions,
    prUrl: spec.kind === 'pr' ? (opts.prUrl ?? null) : undefined,
  }
}
