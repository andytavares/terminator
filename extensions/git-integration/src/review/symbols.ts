import { Parser, Language, type Node } from 'web-tree-sitter'
import type { DiffLine } from '../schemas/git.schema'

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

/**
 * Cached per grammar, loaded lazily on first use. Returns null when `path`'s extension has no grammar.
 * @internal
 */
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

// ─── AST analysis ───────────────────────────────────────────────────────────────

export interface SnippetFunction {
  name: string
  line: number
  branches: number
}

export interface SnippetAnalysis {
  definitions: string[]
  references: string[]
  branches: number
  functions: SnippetFunction[]
}

const KEYWORDS = new Set([
  'if',
  'else',
  'for',
  'while',
  'do',
  'switch',
  'case',
  'default',
  'catch',
  'try',
  'finally',
  'throw',
  'return',
  'break',
  'continue',
  'function',
  'class',
  'interface',
  'type',
  'enum',
  'const',
  'let',
  'var',
  'export',
  'import',
  'from',
  'of',
  'in',
  'new',
  'this',
  'super',
  'typeof',
  'instanceof',
  'void',
  'delete',
  'extends',
  'implements',
  'public',
  'private',
  'protected',
  'static',
  'readonly',
  'async',
  'await',
  'yield',
  'null',
  'undefined',
  'true',
  'false',
  'get',
  'set',
  'as',
  'is',
  'keyof',
  'namespace',
  'declare',
  'abstract',
  'module',
  'def',
  'pass',
  'and',
  'or',
  'not',
  'None',
  'True',
  'False',
  'elif',
  'except',
  'lambda',
  'self',
])

const DEFINITION_TYPES = new Set([
  'function_declaration',
  'generator_function_declaration',
  'class_declaration',
  'interface_declaration',
  'type_alias_declaration',
  'enum_declaration',
])

const FUNCTION_TYPES = new Set([
  'function_declaration',
  'generator_function_declaration',
  'function_expression',
  'arrow_function',
  'method_definition',
])

const BRANCH_TYPES = new Set([
  'if_statement',
  'for_statement',
  'for_in_statement',
  'while_statement',
  'do_statement',
  'switch_case',
  'catch_clause',
  'ternary_expression',
  'conditional_expression',
  'except_clause',
])

const BINARY_BRANCH_OPERATORS = new Set(['&&', '||', '??'])

function isBranchNode(node: Node): boolean {
  if (BRANCH_TYPES.has(node.type)) return true
  if (node.type === 'binary_expression') {
    const op = node.childCount > 1 ? node.child(1)?.text : undefined
    return !!op && BINARY_BRANCH_OPERATORS.has(op)
  }
  return false
}

function countBranches(node: Node): number {
  let count = 0
  function visit(n: Node, isRoot: boolean): void {
    if (!isRoot && FUNCTION_TYPES.has(n.type)) return // nested function's branches counted on its own
    if (isBranchNode(n)) count++
    for (let i = 0; i < n.childCount; i++) visit(n.child(i)!, false)
  }
  visit(node, true)
  return count
}

function isExported(node: Node): boolean {
  let cur: Node | null = node.parent
  while (cur) {
    if (cur.type === 'export_statement') return true
    cur = cur.parent
  }
  return false
}

const DECLARED_FUNCTION_TYPES = new Set([
  'method_definition',
  'function_declaration',
  'generator_function_declaration',
])

const EXPRESSION_FUNCTION_TYPES = new Set(['function_expression', 'arrow_function'])

function declaratorName(node: Node | null): string | null {
  if (node?.type !== 'variable_declarator') return null
  return node.childForFieldName('name')?.text ?? null
}

function functionName(node: Node): string | null {
  const ownName = node.childForFieldName('name')?.text ?? null
  if (DECLARED_FUNCTION_TYPES.has(node.type)) return ownName
  if (!EXPRESSION_FUNCTION_TYPES.has(node.type)) return null
  if (ownName) return ownName
  // export const foo = () => {} — take the enclosing variable_declarator's name
  return declaratorName(node.parent)
}

function addIdentifierBinding(node: Node | null, into: Set<string>): void {
  if (!node) return
  if (node.type === 'identifier' || node.type === 'shorthand_property_identifier_pattern') {
    into.add(node.text)
    return
  }
  // Destructuring patterns (object/array, possibly nested): pull every bound
  // identifier out, skipping object-key `property_identifier` leaves.
  for (let i = 0; i < node.childCount; i++) addIdentifierBinding(node.child(i)!, into)
}

/** The field holding the names a node binds, for node types that bind through one field. */
const BINDING_FIELD_BY_TYPE = new Map([
  ['variable_declarator', 'name'],
  ['required_parameter', 'pattern'],
  ['optional_parameter', 'pattern'],
  ['catch_clause', 'parameter'],
  ['for_in_statement', 'left'],
])

function addBindingsOf(node: Node, bound: Set<string>): void {
  const field = BINDING_FIELD_BY_TYPE.get(node.type)
  if (field) {
    addIdentifierBinding(node.childForFieldName(field), bound)
    return
  }
  if (node.type !== 'formal_parameters') return
  for (let i = 0; i < node.childCount; i++) {
    const child = node.child(i)!
    if (child.type === 'identifier') bound.add(child.text)
  }
}

function collectBoundNames(root: Node, definitions: Set<string>): Set<string> {
  const bound = new Set<string>(definitions)
  function visit(node: Node): void {
    addBindingsOf(node, bound)
    for (let i = 0; i < node.childCount; i++) visit(node.child(i)!)
  }
  visit(root)
  return bound
}

function definesName(node: Node): boolean {
  if (DEFINITION_TYPES.has(node.type) || node.type === 'method_definition') return true
  return node.type === 'variable_declarator' && isExported(node)
}

function collectDefinitions(root: Node): Set<string> {
  const definitions = new Set<string>()
  function visit(node: Node): void {
    const name = definesName(node) ? node.childForFieldName('name')?.text : undefined
    if (name) definitions.add(name)
    for (let i = 0; i < node.childCount; i++) visit(node.child(i)!)
  }
  visit(root)
  return definitions
}

function collectReferences(root: Node, boundNames: Set<string>): Set<string> {
  const references = new Set<string>()

  function visit(node: Node): void {
    if (node.type === 'identifier' || node.type === 'type_identifier') {
      const text = node.text
      if (!KEYWORDS.has(text) && !boundNames.has(text)) references.add(text)
    }
    for (let i = 0; i < node.childCount; i++) visit(node.child(i)!)
  }
  visit(root)
  return references
}

function collectFunctions(root: Node): SnippetFunction[] {
  const functions: SnippetFunction[] = []

  function visit(node: Node): void {
    if (FUNCTION_TYPES.has(node.type)) {
      const name = functionName(node)
      if (name) {
        functions.push({
          name,
          line: node.startPosition.row + 1,
          branches: countBranches(node),
        })
      }
    }
    for (let i = 0; i < node.childCount; i++) visit(node.child(i)!)
  }
  visit(root)
  return functions
}

const parserCache = new Map<Language, Parser>()

/**
 * Parses `code` as `path`'s language, hands the root to `read`, then frees the tree:
 * web-tree-sitter trees live in WASM memory that the JS garbage collector never reclaims.
 * Null when there is no grammar for `path`.
 */
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

function analyseRoot(root: Node): SnippetAnalysis {
  const definitions = collectDefinitions(root)
  const boundNames = collectBoundNames(root, definitions)
  return {
    definitions: [...definitions],
    references: [...collectReferences(root, boundNames)],
    branches: countBranchesInWholeTree(root),
    functions: collectFunctions(root),
  }
}

/** Parses `code` as `path`'s language and extracts definitions, references and branch counts. Null when there is no grammar for `path`. */
export function analyseSnippet(path: string, code: string): Promise<SnippetAnalysis | null> {
  return withSyntaxTree(path, code, analyseRoot)
}

/** Analyses diff lines as one snippet. Null when they hold no text or `path` has no grammar. */
export function analyseLines(path: string, lines: DiffLine[]): Promise<SnippetAnalysis | null> {
  const text = lines.map((l) => l.content).join('\n')
  if (!text) return Promise.resolve(null)
  return analyseSnippet(path, text)
}

function countBranchesInWholeTree(node: Node): number {
  let count = 0
  function visit(n: Node): void {
    if (isBranchNode(n)) count++
    for (let i = 0; i < n.childCount; i++) visit(n.child(i)!)
  }
  visit(node)
  return count
}

// ─── Hunk header symbol extraction ─────────────────────────────────────────────

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

/**
 * Pulls the enclosing symbol name from a unified-diff hunk header's trailing
 * context, e.g. `@@ -56,10 +56,12 @@ export function HealthChips` → `HealthChips`.
 */
export function symbolFromHunkHeader(header: string): string | null {
  const match = header.match(/@@[^@]*@@\s*(.*)$/)
  const trailing = match?.[1]?.trim()
  if (!trailing) return null

  for (const token of trailing.split(/\s+/)) {
    const cleaned = token.replace(/^\*/, '')
    if (HEADER_SKIP_TOKENS.has(cleaned)) continue
    const nameMatch = cleaned.match(/^[A-Za-z_$][A-Za-z0-9_$]*/)
    if (nameMatch) return nameMatch[0]
  }
  return null
}
