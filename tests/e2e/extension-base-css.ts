import { readFileSync, readdirSync, statSync } from 'node:fs'
import { dirname, join } from 'node:path'

// Rebuilds the sheet core injects into every extension view from the builder's imports:
// Playwright's loader cannot import the `?raw` modules EXTENSION_BASE_CSS is built from,
// and reading them means a stylesheet added there needs no second list here.
const BUILDER = 'packages/extension-ui/src/extension-base-css.ts'

/** EXTENSION_BASE_CSS: each `./x.css?raw` file the builder imports, in its order. */
export function extensionBaseCss(root: string): string {
  const builder = join(root, BUILDER)
  const imports = [...readFileSync(builder, 'utf8').matchAll(/from '\.\/(.+\.css)\?raw'/g)]
  if (imports.length === 0) throw new Error(`no ?raw stylesheet imports in ${BUILDER}`)
  return imports.map(([, file]) => readFileSync(join(dirname(builder), file), 'utf8')).join('\n')
}

/** Every .css file under `dir`, recursively. */
export function cssFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name)
    if (statSync(path).isDirectory()) return cssFiles(path)
    return name.endsWith('.css') ? [path] : []
  })
}
