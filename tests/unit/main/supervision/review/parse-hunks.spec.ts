import { describe, it, expect } from 'vitest'
import { parseHunks } from '../../../../../src/main/supervision/review/parse-hunks.js'

const PATCH = `diff --git a/src/a.ts b/src/a.ts
index 111..222 100644
--- a/src/a.ts
+++ b/src/a.ts
@@ -10,3 +10,4 @@ export function thing() {
   const x = 1
+  const asked = true
   return x
@@ -40,2 +41,3 @@ export function other() {
+  const notAsked = true
   return 2
diff --git a/src/b.ts b/src/b.ts
--- a/src/b.ts
+++ b/src/b.ts
@@ -1,2 +1,3 @@
+import x from 'y'
 export const b = 1
`

describe('splitting a diff into reviewable hunks (FR-052)', () => {
  it('produces one hunk per @@ block, not one per file', () => {
    // The whole point: a file can hold both the change you asked for and the
    // one you did not.
    expect(parseHunks(PATCH)).toHaveLength(3)
  })

  it('attributes each hunk to its file', () => {
    expect(parseHunks(PATCH).map((h) => h.file)).toEqual(['src/a.ts', 'src/a.ts', 'src/b.ts'])
  })

  it('records where each hunk starts in the new file', () => {
    expect(parseHunks(PATCH).map((h) => h.newStart)).toEqual([10, 41, 1])
  })

  it('keeps the change and context lines', () => {
    expect(parseHunks(PATCH)[0].lines).toContain('+  const asked = true')
    expect(parseHunks(PATCH)[0].lines).toContain('   return x')
  })

  it('drops diff metadata, which is not reviewable content', () => {
    for (const hunk of parseHunks(PATCH)) {
      expect(hunk.lines.some((line) => line.startsWith('diff --git'))).toBe(false)
      expect(hunk.lines.some((line) => line.startsWith('index '))).toBe(false)
      expect(hunk.lines.some((line) => line.startsWith('--- a/'))).toBe(false)
    }
  })

  it('gives every hunk a distinct id, so decisions cannot collide', () => {
    const ids = parseHunks(PATCH).map((h) => h.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('returns nothing for an empty diff', () => {
    expect(parseHunks('')).toEqual([])
  })

  it('ignores a hunk with no file header rather than inventing one', () => {
    expect(parseHunks('@@ -1,1 +1,2 @@\n+orphan\n')).toEqual([])
  })

  it('handles a file with no trailing newline', () => {
    expect(parseHunks('+++ b/a.ts\n@@ -1,1 +1,1 @@\n+x')).toHaveLength(1)
  })
})
