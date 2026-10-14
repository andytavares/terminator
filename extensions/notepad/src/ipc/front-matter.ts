import yaml from 'js-yaml'

// Reading the YAML block at the top of an exported note.
//
// This replaces gray-matter, which has not been released since 2018 and pins
// js-yaml to a line it then held at a version with a published denial-of-service
// advisory. npm's `overrides` cannot reach it — gray-matter is a dependency of
// this workspace, and overrides declared in the root do not apply inside a
// workspace's own tree — so the only way to stop shipping the vulnerable copy
// was to stop depending on the package.
//
// What is replaced is small and entirely specified by the format we write
// ourselves in this same file's exporter: an opening `---`, a YAML document,
// a closing `---`, then the note body.

export interface FrontMatter {
  /** Parsed YAML, or an empty object when there is none or it is malformed. */
  readonly data: Record<string, unknown>
  /** Everything after the closing delimiter, or the whole input when there is none. */
  readonly content: string
}

const EMPTY: FrontMatter = { data: {}, content: '' }

/**
 * A leading `---` line, YAML, and a closing `---` line.
 *
 * Anchored to the very start, because a `---` further down a markdown document
 * is a horizontal rule and reading it as front matter would swallow the note.
 * `\r?\n` throughout: these files are exported to disk and come back from
 * whatever the operator's other tools wrote them with.
 */
const DELIMITED = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n([\s\S]*))?$/

export function parseFrontMatter(input: string): FrontMatter {
  if (input === '') return EMPTY

  const match = DELIMITED.exec(input)
  if (match === null) return { data: {}, content: input }

  return { data: parseYamlMapping(match[1]), content: match[2] ?? '' }
}

/** The YAML header's fields, or none when it is malformed or not a mapping. */
function parseYamlMapping(text: string): Record<string, unknown> {
  try {
    // js-yaml 4's `load` is the safe schema; on 3 it resolves `!!js/function`, so
    // an imported note could run code on being read. Hence the ^4 pin.
    const parsed = yaml.load(text)
    // A YAML document can be a string, a number or null; only a mapping has fields.
    if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>
    }
  } catch {
    // Malformed YAML. The file is still a note — its body is readable even when
    // its header is not, and dropping the whole file would lose more.
  }
  return {}
}

/**
 * Writes a note back out with its YAML header.
 *
 * `lineWidth: -1` disables line folding: a long title wrapped across lines is
 * still valid YAML, but it is unreadable in a file the operator opens by hand,
 * which is the entire reason these are exported as markdown.
 */
export function stringifyFrontMatter(body: string, data: Record<string, unknown>): string {
  const header = yaml.dump(data, { lineWidth: -1 }).trimEnd()
  return `---\n${header}\n---\n${body}`
}
