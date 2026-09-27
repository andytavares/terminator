import { Parser, Language, type Node } from 'web-tree-sitter'

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

/** Cached per grammar, loaded lazily on first use. Returns null when `path`'s extension has no grammar. */
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

function functionName(node: Node): string | null {
  if (node.type === 'method_definition' || node.type === 'function_declaration') {
    return node.childForFieldName('name')?.text ?? null
  }
  if (node.type === 'generator_function_declaration') {
    return node.childForFieldName('name')?.text ?? null
  }
  if (node.type === 'function_expression' || node.type === 'arrow_function') {
    const nameField = node.childForFieldName('name')?.text
    if (nameField) return nameField
    // export const foo = () => {} — take the enclosing variable_declarator's name
    const declarator = node.parent
    if (declarator?.type === 'variable_declarator') {
      return declarator.childForFieldName('name')?.text ?? null
    }
    return null
  }
  return null
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

function collectBoundNames(root: Node, definitions: Set<string>): Set<string> {
  const bound = new Set<string>(definitions)

  function visit(node: Node): void {
    switch (node.type) {
      case 'variable_declarator':
        addIdentifierBinding(node.childForFieldName('name'), bound)
        break
      case 'required_parameter':
      case 'optional_parameter':
        addIdentifierBinding(node.childForFieldName('pattern'), bound)
        break
      case 'catch_clause':
        addIdentifierBinding(node.childForFieldName('parameter'), bound)
        break
      case 'formal_parameters':
        for (let i = 0; i < node.childCount; i++) {
          const child = node.child(i)!
          if (child.type === 'identifier') bound.add(child.text)
        }
        break
      case 'for_in_statement':
        addIdentifierBinding(node.childForFieldName('left'), bound)
        break
      default:
        break
    }
    for (let i = 0; i < node.childCount; i++) visit(node.child(i)!)
  }
  visit(root)
  return bound
}

function collectDefinitions(root: Node): Set<string> {
  const definitions = new Set<string>()

  function visit(node: Node): void {
    if (DEFINITION_TYPES.has(node.type)) {
      const name = node.childForFieldName('name')?.text
      if (name) definitions.add(name)
    } else if (node.type === 'method_definition') {
      const name = node.childForFieldName('name')?.text
      if (name) definitions.add(name)
    } else if (node.type === 'variable_declarator') {
      if (isExported(node)) {
        const name = node.childForFieldName('name')?.text
        if (name) definitions.add(name)
      }
    }
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

/** Parses `code` as `path`'s language and extracts definitions, references and branch counts. Null when there is no grammar for `path`. */
export async function analyseSnippet(path: string, code: string): Promise<SnippetAnalysis | null> {
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
  const root = tree.rootNode

  const definitions = collectDefinitions(root)
  const boundNames = collectBoundNames(root, definitions)
  const references = collectReferences(root, boundNames)
  const functions = collectFunctions(root)
  const branches = countBranchesInWholeTree(root)

  return {
    definitions: [...definitions],
    references: [...references],
    branches,
    functions,
  }
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
