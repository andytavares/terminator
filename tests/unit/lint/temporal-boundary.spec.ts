import { describe, it, expect } from 'vitest'
import ts from 'typescript'
import { readFileSync } from 'node:fs'
import path from 'node:path'

/** ADR 108: an extension's backend may use Temporal; its view, which also runs in the phone's
 * browser, may not. Each case type-checks one line that uses Temporal against the real tsconfig. */

const extensions = [
  { name: 'Task Vault', root: path.resolve(__dirname, '../../../extensions/task-vault') },
  { name: 'git-integration', root: path.resolve(__dirname, '../../../extensions/git-integration') },
]
const USES_TEMPORAL = 'export const today = Temporal.Now.plainDateISO().toString()\n'

function parsedConfig(root: string, name: string): ts.ParsedCommandLine {
  const parsed = ts.getParsedCommandLineOfConfigFile(
    path.join(root, name),
    {},
    { ...ts.sys, onUnRecoverableConfigFileDiagnostic: () => undefined }
  )
  if (!parsed) throw new Error(`${name} could not be read`)
  return parsed
}

/** What tsc reports for a source file using Temporal under `name`'s compiler options. */
function errorsUsingTemporal(root: string, name: string): string[] {
  const { options } = parsedConfig(root, name)
  const probe = path.join(root, 'src/uses-temporal.ts')
  const host = ts.createCompilerHost(options)
  const readSourceFile = host.getSourceFile.bind(host)
  host.getSourceFile = (fileName, languageVersion) =>
    fileName === probe
      ? ts.createSourceFile(probe, USES_TEMPORAL, languageVersion)
      : readSourceFile(fileName, languageVersion)
  const program = ts.createProgram({ rootNames: [probe], options, host })
  // The probe's own diagnostics only: checking every declaration file the config loads took
  // over 5 s on CI and answers a question this spec does not ask.
  return program
    .getSemanticDiagnostics(program.getSourceFile(probe))
    .map((diagnostic) => ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n'))
}

/** The module the view's page loads, as index.html names it. */
function viewEntry(root: string): string {
  const html = readFileSync(path.join(root, 'index.html'), 'utf-8')
  const source = /<script type="module" src="\/([^"]+)">/.exec(html)?.[1]
  if (!source) throw new Error('index.html names no module script')
  return path.join(root, source)
}

// Type-checked as the file loads, as renderer-size-limits.spec warms ESLint: a program's first
// build loads TypeScript and its libraries, which on a busy CI runner outlasted a test's 5 s.
const ERRORS = new Map(
  extensions.map(({ root }) => [
    root,
    {
      view: errorsUsingTemporal(root, 'tsconfig.view.json'),
      backend: errorsUsingTemporal(root, 'tsconfig.json'),
      specs: errorsUsingTemporal(root, 'tsconfig.test.json'),
    },
  ])
)

describe.each(extensions)('Temporal in $name', ({ root }) => {
  it('is not a name the view can use', () => {
    expect(ERRORS.get(root)?.view).toEqual(["Cannot find name 'Temporal'."])
  })

  it('is checked from the module the view page loads, through everything it imports', () => {
    expect(parsedConfig(root, 'tsconfig.view.json').fileNames).toEqual([viewEntry(root)])
  })

  it('type-checks in the backend', () => {
    expect(ERRORS.get(root)?.backend).toEqual([])
  })

  it('type-checks in the specs', () => {
    expect(ERRORS.get(root)?.specs).toEqual([])
  })
})
