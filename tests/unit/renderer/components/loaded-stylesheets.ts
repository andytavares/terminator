import { readFileSync, statSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'

// Vite gives each lazy import() its own chunk, CSS included, so a class styled
// only in another lazy chunk (the drawer, Settings) is unstyled until that loads.
// Only static imports count: the renderer entry's graph plus the component's.

const ROOT = resolve(__dirname, '../../../..')
const RENDERER_ENTRY = 'src/renderer/index.tsx'
const DESIGN_SYSTEM = 'packages/extension-ui/src'
const STATIC_IMPORT = /^(?:import|export)\b[^'"]*?['"]([^'"]+)['"]/gm

function resolveSpecifier(from: string, specifier: string): string | null {
  const designSystem = specifier.match(/^@terminator\/extension-ui(?:\/(.+))?$/)
  if (designSystem) return firstFile(join(ROOT, DESIGN_SYSTEM, designSystem[1] ?? 'index'))
  if (!specifier.startsWith('.')) return null
  return firstFile(resolve(dirname(from), specifier.replace(/\?raw$/, '')))
}

function firstFile(base: string): string | null {
  const candidates = ['', '.tsx', '.ts', '/index.tsx', '/index.ts'].map((ext) => base + ext)
  return candidates.find((path) => statSync(path, { throwIfNoEntry: false })?.isFile()) ?? null
}

function staticStylesheets(entry: string, seen: Set<string>): string[] {
  if (seen.has(entry)) return []
  seen.add(entry)
  if (entry.endsWith('.css')) return [entry]
  const source = readFileSync(entry, 'utf8')
  return [...source.matchAll(STATIC_IMPORT)].flatMap(([, specifier]) => {
    const target = resolveSpecifier(entry, specifier)
    return target === null ? [] : staticStylesheets(target, seen)
  })
}

/** Every class with a rule in a sheet loaded once `component` (repo-relative) has drawn. */
export function classesStyledFor(component: string): Set<string> {
  const seen = new Set<string>()
  const sheets = [RENDERER_ENTRY, component].flatMap((file) =>
    staticStylesheets(join(ROOT, file), seen)
  )
  const css = sheets.map((sheet) => readFileSync(sheet, 'utf8')).join('\n')
  return new Set([...css.matchAll(/\.(-?[A-Za-z_][\w-]*)/g)].map(([, name]) => name))
}

/** Classes drawn under `root` that no loaded sheet styles. Lucide's markers and the design
 * system's own classes are left out: its components import their sheet, and a default modifier
 * such as `tmui-button--md` has no rule on purpose. */
export function unstyledClasses(root: Element, styled: Set<string>): string[] {
  const drawn = [...root.querySelectorAll('[class]')].flatMap((el) => [...el.classList])
  return [...new Set(drawn)].filter((name) => !/^(lucide|tmui-)/.test(name) && !styled.has(name))
}
