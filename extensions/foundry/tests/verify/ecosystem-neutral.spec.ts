import { describe, it, expect } from 'vitest'
import * as fs from 'node:fs'
import * as path from 'node:path'
import { fileURLToPath } from 'node:url'
import { parse } from '@babel/parser'

// Rule 2 (CLAUDE.md): a literal naming an ecosystem's tool belongs in `hints/`, not in
// code. Comments are never string, template or regex nodes, so they are not read.

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

const LITERALS = new Set(['StringLiteral', 'DirectiveLiteral', 'TemplateElement', 'RegExpLiteral'])

interface SyntaxNode {
  type: string
  start: number
  end: number
  loc: { start: { line: number } }
}

const isNode = (value: unknown): value is SyntaxNode =>
  typeof value === 'object' && value !== null && 'type' in value

/** Every string, template chunk and regex in the tree under `node`. */
function literalsIn(node: unknown): SyntaxNode[] {
  if (Array.isArray(node)) return node.flatMap(literalsIn)
  if (!isNode(node)) return []
  const own = LITERALS.has(node.type) ? [node] : []
  return [
    ...own,
    ...Object.values(node)
      .filter((v) => typeof v === 'object')
      .flatMap(literalsIn),
  ]
}

function sourceFiles(directory: string): string[] {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(directory, entry.name)
    if (entry.isDirectory()) return sourceFiles(full)
    return /\.tsx?$/.test(entry.name) && !entry.name.endsWith('.d.ts') ? [full] : []
  })
}

/** `file:line literal` for each ecosystem literal in one file. */
function hitsIn(file: string): string[] {
  const text = fs.readFileSync(file, 'utf8')
  const plugins: ('typescript' | 'jsx')[] = file.endsWith('x')
    ? ['typescript', 'jsx']
    : ['typescript']
  const tree = parse(text, { sourceType: 'module', plugins })
  return literalsIn(tree.program)
    .map((node) => ({
      line: node.loc.start.line,
      literal: text.slice(node.start, node.end).trim(),
    }))
    .filter(({ literal }) => ECOSYSTEM.test(literal))
    .map(({ line, literal }) => `${path.relative(sourceRoot, file)}:${line} ${literal}`)
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
