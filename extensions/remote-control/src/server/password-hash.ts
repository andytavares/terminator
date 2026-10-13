import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto'

interface ScryptParams {
  cost: number
  blockSize: number
  parallelism: number
  keyBytes: number
}

interface ParsedHash {
  params: ScryptParams
  salt: Buffer
  key: Buffer
}

const FORMAT = 'scrypt'
const SALT_BYTES = 16
const DEFAULT_PARAMS: ScryptParams = { cost: 16384, blockSize: 8, parallelism: 1, keyBytes: 64 }

function deriveKey(password: string, salt: Buffer, params: ScryptParams): Promise<Buffer> {
  const options = { N: params.cost, r: params.blockSize, p: params.parallelism }
  return new Promise((resolve, reject) => {
    scrypt(password, salt, params.keyBytes, options, (error, key) =>
      error ? reject(error) : resolve(key)
    )
  })
}

function parsePositiveInteger(text: string): number | null {
  if (!/^\d+$/.test(text) || Number(text) === 0) return null
  return Number(text)
}

/** `scrypt$cost$blockSize$parallelism$salt$key`, salt and key in base64url. */
function parseHash(stored: string): ParsedHash | null {
  const [format, cost, blockSize, parallelism, salt, key, ...rest] = stored.split('$')
  if (format !== FORMAT || !key || rest.length > 0) return null
  const [costN, blockSizeN, parallelismN] = [cost, blockSize, parallelism].map(parsePositiveInteger)
  const saltBytes = Buffer.from(salt, 'base64url')
  const keyBytes = Buffer.from(key, 'base64url')
  if (costN === null || blockSizeN === null || parallelismN === null) return null
  if (saltBytes.length === 0 || keyBytes.length === 0) return null
  return {
    params: {
      cost: costN,
      blockSize: blockSizeN,
      parallelism: parallelismN,
      keyBytes: keyBytes.length,
    },
    salt: saltBytes,
    key: keyBytes,
  }
}

export function isPasswordHash(stored: string): boolean {
  return parseHash(stored) !== null
}

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(SALT_BYTES)
  const key = await deriveKey(password, salt, DEFAULT_PARAMS)
  const { cost, blockSize, parallelism } = DEFAULT_PARAMS
  return [
    FORMAT,
    cost,
    blockSize,
    parallelism,
    salt.toString('base64url'),
    key.toString('base64url'),
  ].join('$')
}

/** False for a wrong password and for any stored value that is not a scrypt hash. */
export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const parsed = parseHash(stored)
  if (!parsed) return false
  try {
    const candidate = await deriveKey(password, parsed.salt, parsed.params)
    return timingSafeEqual(candidate, parsed.key)
  } catch {
    // scrypt rejects parameters it cannot run (cost not a power of two, too much memory)
    return false
  }
}
