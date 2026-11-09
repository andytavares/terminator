/** Branch exclude patterns as typed, one per line: trimmed, blank lines dropped. */
export function parsePatterns(text: string): string[] {
  return text
    .split('\n')
    .map((p) => p.trim())
    .filter(Boolean)
}

/** Shown in an empty patterns box, as two examples. */
export const PATTERNS_PLACEHOLDER = 'gh-readonly-queue/*\nrenovate/*'
