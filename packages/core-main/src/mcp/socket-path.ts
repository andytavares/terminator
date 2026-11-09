import { createHash } from 'node:crypto'
import { join } from 'node:path'

// macOS refuses a Unix socket path of 104 bytes or more (listen EINVAL).
const MAX_SOCKET_PATH_BYTES = 103

/** Where the Terminator MCP server listens: in the profile folder, or, when that path is too
 * long for a socket, in the per-user temp folder under a name unique to the profile. */
export function mcpSocketPath(userData: string, tmpDir: string): string {
  const inProfile = join(userData, 'mcp.sock')
  if (Buffer.byteLength(inProfile) <= MAX_SOCKET_PATH_BYTES) return inProfile
  const profile = createHash('sha256').update(userData).digest('hex').slice(0, 16)
  return join(tmpDir, `terminator-mcp-${profile}.sock`)
}
