import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import ts from 'typescript'
import { ELECTRON_API_MANIFEST } from '../../../../src/shared/electron-api/manifest'

// The SDK publishes window.electronAPI for extension views by hand, because
// deriving it from the manifest would make the SDK import core. This holds the
// hand-written declaration to the manifest's `extensionView` specs.

function declaredPaths(): string[] {
  const file = path.resolve(__dirname, '../../../../packages/extension-sdk/types/renderer.d.ts')
  const source = ts.createSourceFile(file, readFileSync(file, 'utf8'), ts.ScriptTarget.Latest)
  const api = source.statements.find(
    (node): node is ts.InterfaceDeclaration =>
      ts.isInterfaceDeclaration(node) && node.name.text === 'ElectronAPI'
  )
  if (!api) throw new Error('renderer.d.ts declares no ElectronAPI')
  return api.members.flatMap((namespace) => {
    if (!ts.isPropertySignature(namespace) || !namespace.type) return []
    if (!ts.isTypeLiteralNode(namespace.type)) return []
    const name = namespace.name.getText(source)
    return namespace.type.members.map((member) => `${name}.${member.name!.getText(source)}`)
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
