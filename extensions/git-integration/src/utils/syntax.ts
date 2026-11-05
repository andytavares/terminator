import { extensionOf } from '@terminator/extension-ui'

export { extensionOf, highlight } from '@terminator/extension-ui'

/** The extension of the file a merge block id (`path#index`) belongs to. */
export function extensionOfBlock(blockId: string): string | undefined {
  return extensionOf(blockId.slice(0, blockId.lastIndexOf('#')))
}
