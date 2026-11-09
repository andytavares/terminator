import { join } from 'node:path'
import { mcpSocketPath } from '../../../packages/core-shared/src/mcp/socket-path.js'

// The packaged app's userData folder on macOS: Electron names it after package.json's name.
const APP_PROFILE = 'Library/Application Support/@andytavares/terminator'

export interface SocketLocationInput {
  flag: string | null
  env: Record<string, string | undefined>
  home: string
  tmpDir: string
}

/** The socket to connect to: `--socket`, else TERMINATOR_MCP_SOCKET, else the packaged app's. */
export function socketLocation({ flag, env, home, tmpDir }: SocketLocationInput): string {
  return flag ?? env.TERMINATOR_MCP_SOCKET ?? mcpSocketPath(join(home, APP_PROFILE), tmpDir)
}
