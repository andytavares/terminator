import { describe, it, expect } from 'vitest'
import * as fs from 'node:fs'
import * as path from 'node:path'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'

// Rule 2 (CLAUDE.md): nothing is assumed about a repository's toolchain. A
// literal that names an ecosystem's tool belongs in `hints/` as data, not in
// code. This reads every string, template and regex literal in `src/` and
// fails on one that does; comments are never tokens of those kinds.

const sourceRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../src')

const ECOSYSTEM_WORDS = [
  'npm',
  'npx',
  'node_modules',
  'package.json',
  'package-lock',
  'pnpm',
  'yarn',
  'vitest',
  'jest',
  'eslint',
  'prettier',
  'playwright',
  'pytest',
  'ruff',
  'uv run',
  'cargo',
  'go.mod',
  'go test',
  '.tsx',
  'tsconfig',
]

const escape = (word: string) => word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
const ECOSYSTEM = new RegExp(
  ECOSYSTEM_WORDS.map((word) => `(?<![\\w-])${escape(word)}(?![\\w])`).join('|'),
  'i'
)

const LITERALS = new Set([
  ts.SyntaxKind.StringLiteral,
  ts.SyntaxKind.NoSubstitutionTemplateLiteral,
  ts.SyntaxKind.TemplateHead,
  ts.SyntaxKind.TemplateMiddle,
  ts.SyntaxKind.TemplateTail,
  ts.SyntaxKind.RegularExpressionLiteral,
])

function sourceFiles(directory: string): string[] {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(directory, entry.name)
    if (entry.isDirectory()) return sourceFiles(full)
    return /\.tsx?$/.test(entry.name) && !entry.name.endsWith('.d.ts') ? [full] : []
  })
}

function tokenise(file: string): ts.Scanner {
  const scanner = ts.createScanner(ts.ScriptTarget.Latest, true, undefined, undefined)
  const text = fs.readFileSync(file, 'utf8')
  scanner.setText(text)
  scanner.setLanguageVariant(
    file.endsWith('x') ? ts.LanguageVariant.JSX : ts.LanguageVariant.Standard
  )
  return scanner
}

/** Finds where a template literal's `${…}` closes, so its next chunk is scanned as template text. */
class TemplateTracker {
  private openedAt: number[] = []
  private depth = 0

  next(scanner: ts.Scanner): ts.SyntaxKind {
    let kind = scanner.scan()
    if (kind === ts.SyntaxKind.SlashToken || kind === ts.SyntaxKind.SlashEqualsToken) {
      kind = scanner.reScanSlashToken()
    }
    if (kind === ts.SyntaxKind.OpenBraceToken) this.depth += 1
    if (kind === ts.SyntaxKind.CloseBraceToken) kind = this.close(scanner, kind)
    if (kind === ts.SyntaxKind.TemplateHead || kind === ts.SyntaxKind.TemplateMiddle) {
      this.openedAt.push(this.depth)
    }
    return kind
  }

  private close(scanner: ts.Scanner, kind: ts.SyntaxKind): ts.SyntaxKind {
    if (this.openedAt.at(-1) !== this.depth) {
      this.depth -= 1
      return kind
    }
    this.openedAt.pop()
    return scanner.reScanTemplateToken(false)
  }
}

/** `file:line literal` for each ecosystem literal in one file. */
function hitsIn(file: string): string[] {
  const scanner = tokenise(file)
  const tracker = new TemplateTracker()
  const text = fs.readFileSync(file, 'utf8')
  const hits: string[] = []
  for (
    let kind = tracker.next(scanner);
    kind !== ts.SyntaxKind.EndOfFileToken;
    kind = tracker.next(scanner)
  ) {
    if (!LITERALS.has(kind) || !ECOSYSTEM.test(scanner.getTokenText())) continue
    const line = text.slice(0, scanner.getTokenStart()).split('\n').length
    hits.push(`${path.relative(sourceRoot, file)}:${line} ${scanner.getTokenText().trim()}`)
  }
  return hits
}

describe('the extension assumes no ecosystem', () => {
  it('names no toolchain in a string, template or regex literal', () => {
    const hits = sourceFiles(sourceRoot).flatMap(hitsIn)
    expect(hits).toEqual([])
  })

  it('finds a literal that names a tool, and ignores a comment that does', () => {
    const directory = fs.mkdtempSync(
      path.join(fs.realpathSync(process.env.TMPDIR ?? '/tmp'), 'neutral-')
    )
    const file = path.join(directory, 'sample.ts')
    fs.writeFileSync(
      file,
      "// npm test\nconst a = 'npm test'\nconst b = `x ${a} yarn`\nconst c = /\\.tsx$/\nconst d = 'unusual'\n"
    )
    expect(hitsIn(file).map((hit) => hit.split(' ')[0].split(':')[1])).toEqual(['2', '3', '4'])
    fs.rmSync(directory, { recursive: true })
  })
})
