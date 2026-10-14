import { describe, it, expect } from 'vitest'
import ts from 'typescript'
import { readFileSync } from 'node:fs'
import path from 'node:path'

/** ADR 108: Task Vault's backend may use Temporal; its view, which also runs in the phone's
 * browser, may not. Each case type-checks one line that uses Temporal against the real tsconfig. */

const extensionRoot = path.resolve(__dirname, '../../../extensions/task-vault')
const USES_TEMPORAL = 'export const today = Temporal.Now.plainDateISO().toString()\n'

function parsedConfig(name: string): ts.ParsedCommandLine {
  const parsed = ts.getParsedCommandLineOfConfigFile(
    path.join(extensionRoot, name),
    {},
    { ...ts.sys, onUnRecoverableConfigFileDiagnostic: () => undefined }
  )
  if (!parsed) throw new Error(`${name} could not be read`)
  return parsed
}

/** What tsc reports for a source file using Temporal under `name`'s compiler options. */
function errorsUsingTemporal(name: string): string[] {
  const { options } = parsedConfig(name)
  const probe = path.join(extensionRoot, 'src/uses-temporal.ts')
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
function viewEntry(): string {
  const html = readFileSync(path.join(extensionRoot, 'index.html'), 'utf-8')
  const source = /<script type="module" src="\/([^"]+)">/.exec(html)?.[1]
  if (!source) throw new Error('index.html names no module script')
  return path.join(extensionRoot, source)
}

// Type-checked as the file loads, as renderer-size-limits.spec warms ESLint: a program's first
// build loads TypeScript and its libraries, which on a busy CI runner outlasted a test's 5 s.
const ERRORS = {
  view: errorsUsingTemporal('tsconfig.view.json'),
  backend: errorsUsingTemporal('tsconfig.json'),
  specs: errorsUsingTemporal('tsconfig.test.json'),
}

describe('Temporal in Task Vault', () => {
  it('is not a name the view can use', () => {
    expect(ERRORS.view).toEqual(["Cannot find name 'Temporal'."])
  })

  it('is checked from the module the view page loads, through everything it imports', () => {
    expect(parsedConfig('tsconfig.view.json').fileNames).toEqual([viewEntry()])
  })

  it('type-checks in the backend', () => {
    expect(ERRORS.backend).toEqual([])
  })

  it('type-checks in the specs', () => {
    expect(ERRORS.specs).toEqual([])
  })
})
