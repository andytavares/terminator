import { execFile } from 'node:child_process'
import { copyFileSync, mkdirSync, symlinkSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { promisify } from 'node:util'
import { makeTempDir } from '../../../packages/test-support/src/temp-dir'

/** Lints each case's code at the repo path it names, against the real .oxlintrc.json, in one
 * oxlint run. The sandbox holds only the cases, so the repo's own files never change; its one
 * tsconfig gives the typed rules a program that holds every case. */

const repoRoot = path.resolve(__dirname, '../../..')
const OXLINT = path.join(repoRoot, 'node_modules/.bin/oxlint')
const TSCONFIG = {
  compilerOptions: {
    strict: true,
    jsx: 'react-jsx',
    module: 'esnext',
    moduleResolution: 'bundler',
  },
  include: ['**/*'],
}

export interface LintCase {
  file: string
  code: string
}

export interface Finding {
  rule: string
  message: string
}

interface OxlintDiagnostic {
  code: string
  message: string
  help?: string
  filename: string
}

function sandboxWith(cases: LintCase[]): string {
  const root = makeTempDir('oxlint-')
  symlinkSync(path.join(repoRoot, 'node_modules'), path.join(root, 'node_modules'))
  mkdirSync(path.join(root, 'scripts'))
  symlinkSync(
    path.join(repoRoot, 'scripts/oxlint-plugin'),
    path.join(root, 'scripts/oxlint-plugin')
  )
  copyFileSync(path.join(repoRoot, '.oxlintrc.json'), path.join(root, '.oxlintrc.json'))
  writeFileSync(path.join(root, 'tsconfig.json'), JSON.stringify(TSCONFIG))
  for (const { file, code } of cases) {
    mkdirSync(path.dirname(path.join(root, file)), { recursive: true })
    writeFileSync(path.join(root, file), code)
  }
  return root
}

/** `plugin(rule)` as oxlint prints it, written `plugin/rule`. */
function ruleOf(code: string): string {
  return code.replace(/^(.+)\((.+)\)$/, '$1/$2')
}

/** Each case file's findings, keyed by its repo path. oxlint exits 1 when it finds any. */
export async function lintCases(cases: LintCase[]): Promise<Map<string, Finding[]>> {
  const root = sandboxWith(cases)
  const files = cases.map(({ file }) => file)
  const output = await promisify(execFile)(OXLINT, ['-f', 'json', ...files], {
    cwd: root,
  }).catch((error: { stdout: string }) => ({ stdout: error.stdout }))
  const { diagnostics } = JSON.parse(output.stdout) as { diagnostics: OxlintDiagnostic[] }
  const findings = new Map<string, Finding[]>(files.map((file) => [file, []]))
  for (const diagnostic of diagnostics) {
    findings.get(diagnostic.filename)?.push({
      rule: ruleOf(diagnostic.code),
      message: `${diagnostic.message} ${diagnostic.help ?? ''}`,
    })
  }
  return findings
}
