import type { KnowledgeRef } from '../types/speckit.types.js'

/**
 * Parse `rg --line-number --no-heading` output lines of the form
 * `path:line:snippet` into KnowledgeRefs. Malformed lines are skipped.
 */
export function parseRgLines(stdout: string, limit = 100): KnowledgeRef[] {
  const results: KnowledgeRef[] = []
  for (const raw of stdout.split('\n')) {
    if (!raw.trim()) continue
    const m = raw.match(/^(.+?):(\d+):(.*)$/)
    if (!m) continue
    const line = parseInt(m[2], 10)
    if (Number.isNaN(line)) continue
    results.push({ file: m[1], line, snippet: m[3].trim() })
    if (results.length >= limit) break
  }
  return results
}

/**
 * Case-insensitive keyword scan across in-memory files. Returns one KnowledgeRef
 * per matching line. Pure — no I/O.
 */
export function searchFiles(
  files: { file: string; content: string }[],
  query: string,
  limit = 100
): KnowledgeRef[] {
  const needle = query.toLowerCase().trim()
  const results: KnowledgeRef[] = []
  if (needle.length === 0) return results
  for (const { file, content } of files) {
    const lines = content.split('\n')
    for (let i = 0; i < lines.length; i++) {
      if (lines[i].toLowerCase().includes(needle)) {
        results.push({ file, line: i + 1, snippet: lines[i].trim().slice(0, 200) })
        if (results.length >= limit) return results
      }
    }
  }
  return results
}
