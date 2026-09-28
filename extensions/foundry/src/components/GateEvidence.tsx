import React from 'react'
import type { Evidence, EvidenceKind } from '../verify/verdict.js'

const KIND_IN_WORDS: Record<EvidenceKind, string> = {
  exit_code: 'An exit code',
  stdout: 'The output',
  report_file: 'A report file',
  screenshot: 'A screenshot',
  diff: 'A diff',
}

function label(piece: Evidence): string {
  if (piece.kind === 'exit_code' && piece.exitCode !== undefined)
    return `Exit code ${piece.exitCode}`
  return KIND_IN_WORDS[piece.kind]
}

/** What a gate saw, shown so the operator can judge it without opening a terminal. */
export function GateEvidence({ evidence }: { evidence: readonly Evidence[] }) {
  if (evidence.length === 0) return null
  return (
    <div className="fdry-gate-evidence">
      {evidence.map((piece, index) =>
        piece.excerpt ? (
          <details key={`${piece.kind}-${index}`} open>
            <summary>Last lines of the output</summary>
            <pre className="fdry-gate-evidence-pre">{piece.excerpt}</pre>
            {piece.path ? <p className="fdry-note">Full log: {piece.path}</p> : null}
          </details>
        ) : (
          <p key={`${piece.kind}-${index}`} className="fdry-note">
            {label(piece)}
            {piece.path ? `: ${piece.path}` : ''}
          </p>
        )
      )}
    </div>
  )
}
