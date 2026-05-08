import { describe, it, expect } from 'vitest'
import { parseStatus, parseDiff } from '../../src/git/git-parser'

describe('parseStatus()', () => {
  it('parses a modified unstaged file', () => {
    // porcelain v1 -z format: XY<space>path\0
    const stdout = ' M src/main.ts\0'
    const result = parseStatus(stdout, 500)
    expect(result.files).toHaveLength(1)
    expect(result.files[0]).toMatchObject({
      path: 'src/main.ts',
      status: 'modified',
      staged: false,
    })
  })

  it('parses a staged new file (A)', () => {
    const stdout = 'A  src/new.ts\0'
    const result = parseStatus(stdout, 500)
    expect(result.files[0]).toMatchObject({
      path: 'src/new.ts',
      status: 'added',
      staged: true,
    })
  })

  it('parses an untracked file (??)', () => {
    const stdout = '?? notes.txt\0'
    const result = parseStatus(stdout, 500)
    expect(result.files[0]).toMatchObject({
      path: 'notes.txt',
      status: 'untracked',
      staged: false,
    })
  })

  it('parses a deleted file (D)', () => {
    const stdout = ' D old.ts\0'
    const result = parseStatus(stdout, 500)
    expect(result.files[0]).toMatchObject({
      path: 'old.ts',
      status: 'deleted',
      staged: false,
    })
  })

  it('parses a renamed file (R) with original path', () => {
    // Renamed: "R " XY new-path\0old-path\0
    const stdout = 'R  new.ts\0old.ts\0'
    const result = parseStatus(stdout, 500)
    expect(result.files[0]).toMatchObject({
      path: 'new.ts',
      originalPath: 'old.ts',
      status: 'renamed',
      staged: true,
    })
  })

  it('parses a conflicted file (UU)', () => {
    const stdout = 'UU conflict.ts\0'
    const result = parseStatus(stdout, 500)
    expect(result.files[0]).toMatchObject({
      path: 'conflict.ts',
      status: 'conflicted',
    })
    expect(result.hasConflicts).toBe(true)
  })

  it('sets truncated=true when file count exceeds maxFiles', () => {
    // Build output with 3 files but cap at 2
    const stdout = ' M a.ts\0 M b.ts\0 M c.ts\0'
    const result = parseStatus(stdout, 2)
    expect(result.files).toHaveLength(2)
    expect(result.truncated).toBe(true)
  })

  it('returns empty files array for empty output', () => {
    const result = parseStatus('', 500)
    expect(result.files).toHaveLength(0)
    expect(result.hasConflicts).toBe(false)
    expect(result.truncated).toBe(false)
  })

  it('handles multiple files', () => {
    const stdout = ' M a.ts\0?? b.ts\0A  c.ts\0'
    const result = parseStatus(stdout, 500)
    expect(result.files).toHaveLength(3)
  })
})

describe('parseDiff()', () => {
  const sampleDiff = `diff --git a/src/main.ts b/src/main.ts
index abc123..def456 100644
--- a/src/main.ts
+++ b/src/main.ts
@@ -1,4 +1,5 @@
 function main() {
-  console.log('hello')
+  console.log('world')
+  console.log('!')
 }
`

  it('parses hunk header', () => {
    const diff = parseDiff(sampleDiff)
    expect(diff.hunks).toHaveLength(1)
    expect(diff.hunks[0].header).toContain('@@ -1,4 +1,5 @@')
  })

  it('parses add lines (green)', () => {
    const diff = parseDiff(sampleDiff)
    const addLines = diff.hunks[0].lines.filter((l) => l.type === 'add')
    expect(addLines).toHaveLength(2)
    expect(addLines[0].content).toBe("  console.log('world')")
  })

  it('parses remove lines (red)', () => {
    const diff = parseDiff(sampleDiff)
    const removeLines = diff.hunks[0].lines.filter((l) => l.type === 'remove')
    expect(removeLines).toHaveLength(1)
    expect(removeLines[0].content).toBe("  console.log('hello')")
  })

  it('parses context lines', () => {
    const diff = parseDiff(sampleDiff)
    const contextLines = diff.hunks[0].lines.filter((l) => l.type === 'context')
    expect(contextLines.length).toBeGreaterThan(0)
  })

  it('detects binary files', () => {
    const binaryDiff = 'Binary files a/img.png and b/img.png differ\n'
    const diff = parseDiff(binaryDiff)
    expect(diff.isBinary).toBe(true)
    expect(diff.hunks).toHaveLength(0)
  })

  it('sets truncated flag for large output', () => {
    const bigLine = 'x'.repeat(1000)
    const largeDiff = `diff --git a/big.ts b/big.ts\n--- a/big.ts\n+++ b/big.ts\n@@ -1 +1 @@\n+${bigLine}\n`.repeat(600)
    const diff = parseDiff(largeDiff, 512 * 1024)
    expect(diff.truncated).toBe(true)
  })

  it('assigns correct line numbers to add/remove/context', () => {
    const diff = parseDiff(sampleDiff)
    const lines = diff.hunks[0].lines
    const firstContext = lines.find((l) => l.type === 'context')
    expect(firstContext?.oldLineNumber).toBe(1)
    expect(firstContext?.newLineNumber).toBe(1)
  })
})
