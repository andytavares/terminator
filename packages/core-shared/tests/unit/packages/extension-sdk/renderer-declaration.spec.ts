import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { parse } from '@babel/parser'
import { ELECTRON_API_MANIFEST } from '../../../../src/electron-api/manifest'

// The SDK publishes window.electronAPI for extension views by hand, because
// deriving it from the manifest would make the SDK import core. This holds the
// hand-written declaration to the manifest's `extensionView` specs.

type Statement = ReturnType<typeof parse>['program']['body'][number]
type Interface = Extract<Statement, { type: 'TSInterfaceDeclaration' }>
type TSTypeElement = Interface['body']['body'][number]

/** A property's name as written: an identifier or a quoted string. */
function keyName(member: TSTypeElement): string {
  if (member.type !== 'TSPropertySignature' && member.type !== 'TSMethodSignature') return ''
  const { key } = member
  if (key.type === 'Identifier') return key.name
  return key.type === 'StringLiteral' ? key.value : ''
}

function declaredPaths(): string[] {
  const file = path.resolve(__dirname, '../../../../../extension-sdk/types/renderer.d.ts')
  const source = parse(readFileSync(file, 'utf8'), {
    sourceType: 'module',
    plugins: [['typescript', { dts: true }]],
  })
  const api = source.program.body
    .map((node) => (node.type === 'ExportNamedDeclaration' ? node.declaration : node))
    .find((node) => node?.type === 'TSInterfaceDeclaration' && node.id.name === 'ElectronAPI')
  if (api?.type !== 'TSInterfaceDeclaration')
    throw new Error('renderer.d.ts declares no ElectronAPI')
  return api.body.body.flatMap((namespace) => {
    if (namespace.type !== 'TSPropertySignature') return []
    const type = namespace.typeAnnotation?.typeAnnotation
    if (type?.type !== 'TSTypeLiteral') return []
    return type.members.map((member) => `${keyName(namespace)}.${keyName(member)}`)
  })
}

describe('the SDK renderer declaration', () => {
  it('declares exactly what an extension view receives', () => {
    const delivered = ELECTRON_API_MANIFEST.filter(
      (spec) => 'extensionView' in spec && spec.extensionView !== undefined
    ).map((spec) => spec.path)

    expect(declaredPaths().sort()).toEqual(delivered.sort())
  })
})
