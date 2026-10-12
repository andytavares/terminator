import { hashPassword, isPasswordHash } from './password-hash.js'

interface CredentialSettings {
  get<T>(key: string): T | undefined
  set(key: string, value: unknown): void
}

interface CredentialKeys {
  /** Where versions before ADR-100 kept the password itself. Always emptied. */
  legacyPassword: string
  passwordHash: string
}

type MigrationOutcome = 'current' | 'migrated' | 'invalidated'

/**
 * The only place the password's storage is decided. The password is kept as a
 * scrypt hash; nothing here ever returns or stores the password itself.
 */
export class CredentialStore {
  constructor(
    private readonly settings: CredentialSettings,
    private readonly keys: CredentialKeys
  ) {}

  getPasswordHash(): string {
    return this.settings.get<string>(this.keys.passwordHash) ?? ''
  }

  hasPassword(): boolean {
    return isPasswordHash(this.getPasswordHash())
  }

  async setPassword(password: string): Promise<void> {
    this.settings.set(this.keys.passwordHash, await hashPassword(password))
    this.settings.set(this.keys.legacyPassword, '')
  }

  /**
   * A stored plaintext is hashed so the password keeps working, then erased.
   * A bcrypt hash cannot be converted, so it is cleared and the password must
   * be set again.
   */
  async migrateLegacy(): Promise<MigrationOutcome> {
    const plaintext = this.settings.get<string>(this.keys.legacyPassword) ?? ''
    if (plaintext && !this.hasPassword()) {
      await this.setPassword(plaintext)
      return 'migrated'
    }
    if (plaintext) this.settings.set(this.keys.legacyPassword, '')
    if (this.getPasswordHash() && !this.hasPassword()) {
      this.settings.set(this.keys.passwordHash, '')
      return 'invalidated'
    }
    return 'current'
  }
}
