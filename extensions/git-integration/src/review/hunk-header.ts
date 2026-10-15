const HEADER_SKIP_TOKENS = new Set([
  'export',
  'default',
  'async',
  'function',
  'function*',
  'class',
  'interface',
  'type',
  'enum',
  'const',
  'let',
  'var',
  'public',
  'private',
  'protected',
  'static',
  'get',
  'set',
  'abstract',
  'declare',
  'namespace',
  'def',
])

/** The text git prints after a hunk header's `@@ -a,b +c,d @@` ranges, or null when there is none. */
export function hunkContextText(header: string): string | null {
  const trailing = header.match(/@@[^@]*@@\s*(.*)$/)?.[1]?.trim()
  return trailing || null
}

/** The enclosing symbol in a hunk header's context: `@@ -56,10 +56,12 @@ export function HealthChips` gives `HealthChips`. */
export function symbolFromHunkHeader(header: string): string | null {
  const trailing = hunkContextText(header)
  if (!trailing) return null

  for (const token of trailing.split(/\s+/)) {
    const cleaned = token.replace(/^\*/, '')
    if (HEADER_SKIP_TOKENS.has(cleaned)) continue
    const nameMatch = cleaned.match(/^[A-Za-z_$][A-Za-z0-9_$]*/)
    if (nameMatch) return nameMatch[0]
  }
  return null
}
