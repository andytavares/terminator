import { Parser, Language, Query, type Node, type QueryMatch } from 'web-tree-sitter'
import type { DiffLine } from '../schemas/git.schema'
import cSharpTags from './tags/c-sharp.scm?raw'
import cppTags from './tags/cpp.scm?raw'
import goTags from './tags/go.scm?raw'
import javaTags from './tags/java.scm?raw'
import javascriptTags from './tags/javascript.scm?raw'
import phpTags from './tags/php.scm?raw'
import pythonTags from './tags/python.scm?raw'
import rubyTags from './tags/ruby.scm?raw'
import rustTags from './tags/rust.scm?raw'
import typescriptTags from './tags/typescript.scm?raw'

// ─── Grammar loading ───────────────────────────────────────────────────────────

const GRAMMAR_BY_EXT: Record<string, string> = {
  ts: 'typescript',
  mts: 'typescript',
  cts: 'typescript',
  tsx: 'tsx',
  js: 'javascript',
  jsx: 'javascript',
  mjs: 'javascript',
  cjs: 'javascript',
  py: 'python',
  go: 'go',
  rs: 'rust',
  java: 'java',
  cs: 'c-sharp',
  rb: 'ruby',
  php: 'php',
  cpp: 'cpp',
  cc: 'cpp',
  cxx: 'cpp',
  hpp: 'cpp',
  h: 'cpp',
  sh: 'bash',
  bash: 'bash',
  css: 'css',
  scss: 'css',
}

function grammarNameFor(path: string): string | null {
  const ext = path.split('.').pop()?.toLowerCase() ?? ''
  return GRAMMAR_BY_EXT[ext] ?? null
}

let initPromise: Promise<void> | null = null
function ensureInit(): Promise<void> {
  if (!initPromise) initPromise = Parser.init()
  return initPromise
}

const languageCache = new Map<string, Promise<Language | null>>()

/** Cached per grammar, loaded on first use; null when `path`'s extension has no grammar.
 *  @internal */
export function loadLanguageFor(path: string): Promise<Language | null> {
  const grammar = grammarNameFor(path)
  if (!grammar) return Promise.resolve(null)
  let cached = languageCache.get(grammar)
  if (!cached) {
    cached = ensureInit().then(() =>
      Language.load(require.resolve(`@vscode/tree-sitter-wasm/wasm/tree-sitter-${grammar}.wasm`))
    )
    languageCache.set(grammar, cached)
  }
  return cached
}

// ─── Tags queries ───────────────────────────────────────────────────────────────

/** Each grammar's upstream tags query (`tags` in its tree-sitter.json); typescript and tsx
 *  compose the javascript one after their own. Grammars with no upstream tags query are absent. */
const TAGS_BY_GRAMMAR: Record<string, string> = {
  typescript: typescriptTags + javascriptTags,
  tsx: typescriptTags + javascriptTags,
  javascript: javascriptTags,
  python: pythonTags,
  go: goTags,
  rust: rustTags,
  java: javaTags,
  'c-sharp': cSharpTags,
  ruby: rubyTags,
  php: phpTags,
  cpp: cppTags,
}

const queryCache = new Map<string, Query | null>()

async function tagsQueryFor(path: string): Promise<Query | null> {
  const grammar = grammarNameFor(path)
  const tags = grammar ? TAGS_BY_GRAMMAR[grammar] : undefined
  if (!grammar || !tags) return null
  let query = queryCache.get(grammar)
  if (query === undefined) {
    const language = await loadLanguageFor(path)
    query = language ? new Query(language, tags) : null
    queryCache.set(grammar, query)
  }
  return query
}

interface Tag {
  role: 'definition' | 'reference'
  kind: string
  name: Node
  node: Node
}

/** The tag a match stands for: its `@name` node and its `@definition.*` / `@reference.*` node. */
function tagOf(match: QueryMatch): Tag | null {
  const name = match.captures.find((c) => c.name === 'name')?.node
  const tagged = match.captures.find(
    (c) => c.name.startsWith('definition.') || c.name.startsWith('reference.')
  )
  if (!name || !tagged) return null
  const [role, kind] = tagged.name.split('.') as [Tag['role'], string]
  return { role, kind, name, node: tagged.node }
}

function tagsIn(root: Node, query: Query): Tag[] {
  return query.matches(root).flatMap((match) => tagOf(match) ?? [])
}

// ─── Branches ───────────────────────────────────────────────────────────────────

/** Words that mark a control-flow node in any grammar's node type, matched per `_`-separated part. */
const BRANCH_WORDS = new Set([
  'if',
  'elif',
  'elsif',
  'case',
  'for',
  'foreach',
  'while',
  'catch',
  'except',
  'rescue',
  'conditional',
  'ternary',
])

const SHORT_CIRCUIT_OPERATORS = new Set(['&&', '||', '??'])

function isShortCircuit(node: Node): boolean {
  const operator = node.childCount === 3 ? node.child(1) : null
  return !!operator && !operator.isNamed && SHORT_CIRCUIT_OPERATORS.has(operator.type)
}

function isBranchNode(node: Node): boolean {
  if (!node.isNamed) return false
  return node.type.split('_').some((part) => BRANCH_WORDS.has(part)) || isShortCircuit(node)
}

/** Branches under `node`, not descending into `nested` (other functions count their own). */
function countBranches(node: Node, nested: Set<number>): number {
  let count = 0
  function visit(n: Node): void {
    if (isBranchNode(n)) count++
    for (const child of n.children) if (!nested.has(child.id)) visit(child)
  }
  visit(node)
  return count
}

// ─── AST analysis ───────────────────────────────────────────────────────────────

export interface SnippetFunction {
  name: string
  line: number
  endLine: number
  branches: number
}

export interface SnippetAnalysis {
  definitions: string[]
  references: string[]
  branches: number
  functions: SnippetFunction[]
}

function isFunctionTag(tag: Tag): boolean {
  return tag.role === 'definition' && (tag.kind === 'function' || tag.kind === 'method')
}

/** One function per definition node: a grammar can tag one node as both method and function. */
function functionTagsOf(tags: Tag[]): Tag[] {
  const byNode = new Map<number, Tag>()
  for (const tag of tags)
    if (isFunctionTag(tag) && !byNode.has(tag.node.id)) byNode.set(tag.node.id, tag)
  return [...byNode.values()].sort((a, b) => a.node.startIndex - b.node.startIndex)
}

function functionsOf(tags: Tag[]): SnippetFunction[] {
  const functionTags = functionTagsOf(tags)
  const nested = new Set(functionTags.map((tag) => tag.node.id))
  return functionTags.map((tag) => ({
    name: tag.name.text,
    line: tag.node.startPosition.row + 1,
    endLine: tag.node.endPosition.row + 1,
    branches: countBranches(tag.node, nested),
  }))
}

function analyseTags(root: Node, tags: Tag[]): SnippetAnalysis {
  const definitions = new Set(tags.filter((t) => t.role === 'definition').map((t) => t.name.text))
  const references = tags
    .filter((t) => t.role === 'reference' && !definitions.has(t.name.text))
    .map((t) => t.name.text)
  return {
    definitions: [...definitions],
    references: [...new Set(references)],
    branches: countBranches(root, new Set()),
    functions: functionsOf(tags),
  }
}

const parserCache = new Map<Language, Parser>()

/** Parses `code` as `path`'s language, hands the root to `read`, then frees the tree:
 *  web-tree-sitter trees live in WASM memory the JS GC never reclaims. Null with no grammar. */
export async function withSyntaxTree<T>(
  path: string,
  code: string,
  read: (root: Node) => T
): Promise<T | null> {
  const language = await loadLanguageFor(path)
  if (!language) return null

  let parser = parserCache.get(language)
  if (!parser) {
    parser = new Parser()
    parser.setLanguage(language)
    parserCache.set(language, parser)
  }

  const tree = parser.parse(code)
  if (!tree) return null
  try {
    return read(tree.rootNode)
  } finally {
    tree.delete()
  }
}

/** Parses `code` as `path`'s language and reads its tags query. Null with no grammar or tags query. */
async function withTags<T>(
  path: string,
  code: string,
  read: (root: Node, tags: Tag[]) => T
): Promise<T | null> {
  const query = await tagsQueryFor(path)
  if (!query) return null
  return withSyntaxTree(path, code, (root) => read(root, tagsIn(root, query)))
}

/** Parses `code` as `path`'s language and extracts definitions, references and branch counts.
 *  Null when `path`'s grammar is missing or ships no tags query. */
export function analyseSnippet(path: string, code: string): Promise<SnippetAnalysis | null> {
  return withTags(path, code, analyseTags)
}

/** Analyses diff lines as one snippet. Null when they hold no text or `path` has no tags query. */
export function analyseLines(path: string, lines: DiffLine[]): Promise<SnippetAnalysis | null> {
  const text = lines.map((l) => l.content).join('\n')
  if (!text) return Promise.resolve(null)
  return analyseSnippet(path, text)
}

export interface SnippetTags {
  definitions: Array<{ name: string; kind: string; startLine: number; endLine: number }>
  references: Array<{ name: string; line: number }>
}

function listTags(_root: Node, tags: Tag[]): SnippetTags {
  return {
    definitions: tags
      .filter((t) => t.role === 'definition')
      .map((t) => ({
        name: t.name.text,
        kind: t.kind,
        startLine: t.node.startPosition.row + 1,
        endLine: t.node.endPosition.row + 1,
      })),
    references: tags
      .filter((t) => t.role === 'reference')
      .map((t) => ({ name: t.name.text, line: t.name.startPosition.row + 1 })),
  }
}

/** Every tagged definition and reference in `code`, in match order. Null when `path`'s grammar is
 *  missing or ships no tags query. */
export function tagsOf(path: string, code: string): Promise<SnippetTags | null> {
  return withTags(path, code, listTags)
}
