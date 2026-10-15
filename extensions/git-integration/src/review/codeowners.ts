/** The signed-in user: their login and the `org/slug` of each team they are on. */
export interface CodeownersViewer {
  login: string
  teams: string[]
}

interface Rule {
  matches: RegExp
  owners: string[]
}

const GLOB_TOKEN = /\*\*\/|\/\*\*$|\*\*|\*|\?|[.+^${}()|[\]\\]/g

function regexSourceOf(token: string): string {
  if (token === '**/') return '(?:.*/)?'
  if (token === '/**') return '/.*'
  if (token === '**') return '.*'
  if (token === '*') return '[^/]*'
  if (token === '?') return '[^/]'
  return `\\${token}`
}

/** A gitignore-style pattern as GitHub reads it: anchored when it holds a slash before its last
 *  character, otherwise matching at any depth, and always covering what lies beneath a match. */
function patternRegExp(pattern: string): RegExp {
  const trimmed = pattern.replace(/\/$/, '')
  const anchored = trimmed.includes('/')
  const body = trimmed.replace(/^\//, '').replace(GLOB_TOKEN, regexSourceOf)
  return new RegExp(`^${anchored ? '' : '(?:.*/)?'}${body}(?:/.*)?$`)
}

function ruleOf(line: string): Rule | null {
  const [pattern, ...owners] = line.split(/\s+#/)[0].trim().split(/\s+/)
  if (!pattern || pattern.startsWith('#')) return null
  const handles = owners.filter((o) => o.startsWith('@')).map((o) => o.slice(1).toLowerCase())
  return { matches: patternRegExp(pattern), owners: handles }
}

function rulesOf(codeowners: string): Rule[] {
  return codeowners.split('\n').flatMap((line) => ruleOf(line) ?? [])
}

/** The paths the viewer owns, by login or by a team: the last rule that matches a path decides. */
export function ownedPaths(
  codeowners: string,
  paths: string[],
  viewer: CodeownersViewer
): string[] {
  const rules = rulesOf(codeowners)
  const handles = new Set([viewer.login, ...viewer.teams].map((h) => h.toLowerCase()))
  return paths.filter((path) => {
    const rule = [...rules].reverse().find((r) => r.matches.test(path))
    return rule?.owners.some((owner) => handles.has(owner)) ?? false
  })
}
