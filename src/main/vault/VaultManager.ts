import { app, safeStorage } from 'electron'
import { randomUUID, randomBytes, scryptSync, createCipheriv, createDecipheriv } from 'crypto'
import { existsSync, readFileSync, writeFileSync, mkdirSync, rmSync } from 'fs'
import { join, dirname } from 'path'
import type {
  VaultData,
  Host,
  Group,
  Credential,
  LlmSettings,
  LlmConfigLegacy,
  VaultImportResult
} from '../../shared/types'

interface VaultFile {
  version: 1
  salt: string
  iv: string
  authTag: string
  ciphertext: string
}

const EXPORT_TYPE = 'ssh-client-vault-export'

/** Portable, password-encrypted envelope for exporting hosts/groups/credentials. */
interface VaultExportFile {
  type: typeof EXPORT_TYPE
  version: 1
  salt: string
  iv: string
  authTag: string
  ciphertext: string
}

/** Plaintext payload inside a VaultExportFile (only the shareable records). */
interface ExportPayload {
  hosts: Host[]
  groups: Group[]
  credentials: Credential[]
}

const SCRYPT_KEYLEN = 32
const SCRYPT_OPTS = { N: 16384, r: 8, p: 1 }

function emptyVaultData(): VaultData {
  return { hosts: [], groups: [], credentials: [] }
}

export class VaultManager {
  private filePath: string
  private trustPath: string
  private key: Buffer | null = null
  private data: VaultData | null = null
  /** Kept only while unlocked, so "trust this device" can re-encrypt it on demand. */
  private masterPassword: string | null = null

  constructor() {
    this.filePath = join(app.getPath('userData'), 'vault.dat')
    this.trustPath = join(app.getPath('userData'), 'trusted-device.dat')
  }

  isInitialized(): boolean {
    return existsSync(this.filePath)
  }

  isUnlocked(): boolean {
    return this.key !== null && this.data !== null
  }

  create(masterPassword: string): void {
    if (this.isInitialized()) {
      throw new Error('Vault already initialized')
    }
    const salt = randomBytes(16)
    const key = scryptSync(masterPassword, salt, SCRYPT_KEYLEN, SCRYPT_OPTS)
    this.key = key
    this.data = emptyVaultData()
    this.masterPassword = masterPassword
    this.persist(salt)
  }

  unlock(masterPassword: string): void {
    if (!this.isInitialized()) {
      throw new Error('Vault not initialized')
    }
    const raw: VaultFile = JSON.parse(readFileSync(this.filePath, 'utf8'))
    const salt = Buffer.from(raw.salt, 'base64')
    const key = scryptSync(masterPassword, salt, SCRYPT_KEYLEN, SCRYPT_OPTS)
    const iv = Buffer.from(raw.iv, 'base64')
    const authTag = Buffer.from(raw.authTag, 'base64')
    const ciphertext = Buffer.from(raw.ciphertext, 'base64')

    const decipher = createDecipheriv('aes-256-gcm', key, iv)
    decipher.setAuthTag(authTag)
    let plaintext: Buffer
    try {
      plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()])
    } catch {
      throw new Error('Incorrect master password')
    }

    this.key = key
    this.data = JSON.parse(plaintext.toString('utf8'))
    this.masterPassword = masterPassword
  }

  lock(): void {
    this.key = null
    this.data = null
    this.masterPassword = null
  }

  // Trusted device: remember the master password under OS-level encryption
  // (DPAPI on Windows, Keychain on macOS, libsecret on Linux) so the next
  // launch can unlock without a prompt.

  /** False on systems without an OS credential store (e.g. Linux with no keyring). */
  isTrustSupported(): boolean {
    return safeStorage.isEncryptionAvailable()
  }

  isTrusted(): boolean {
    return this.isTrustSupported() && existsSync(this.trustPath)
  }

  /** Store the current master password for this device. Requires an unlocked vault. */
  trustDevice(): void {
    this.assertUnlocked()
    if (!this.isTrustSupported()) {
      throw new Error('当前系统不支持安全存储,无法信任此设备')
    }
    const blob = safeStorage.encryptString(this.masterPassword as string)
    mkdirSync(dirname(this.trustPath), { recursive: true })
    writeFileSync(this.trustPath, blob)
  }

  revokeTrust(): void {
    rmSync(this.trustPath, { force: true })
  }

  /**
   * Unlock using the remembered password. Returns false (and drops the stale
   * record) when there is nothing usable to unlock with — e.g. the vault was
   * recreated with a different password, or the blob can no longer be decrypted
   * because the OS credential changed.
   */
  unlockWithTrust(): boolean {
    if (!this.isInitialized() || !this.isTrusted()) return false
    let password: string
    try {
      password = safeStorage.decryptString(readFileSync(this.trustPath))
    } catch {
      this.revokeTrust()
      return false
    }
    try {
      this.unlock(password)
    } catch {
      this.revokeTrust()
      return false
    }
    return true
  }

  getData(): VaultData {
    this.assertUnlocked()
    return this.data as VaultData
  }

  getLlmSettings(): LlmSettings {
    const data = this.getData()
    const raw = data.llm
    if (!raw) return { providers: [] }
    if ('providers' in raw) return raw as LlmSettings
    // migrate legacy single-config shape
    const legacy = raw as LlmConfigLegacy
    if (legacy.baseUrl !== undefined) {
      const provId = randomUUID()
      const modelId = randomUUID()
      const migrated: LlmSettings = {
        providers: [
          {
            id: provId,
            name: '默认',
            baseUrl: legacy.baseUrl,
            apiKey: legacy.apiKey ?? '',
            models: legacy.model ? [{ id: modelId, name: legacy.model }] : []
          }
        ],
        activeProviderId: provId,
        activeModelId: legacy.model ? modelId : undefined
      }
      data.llm = migrated
      this.persist()
      return migrated
    }
    return { providers: [] }
  }

  setLlmSettings(settings: LlmSettings): void {
    const data = this.getData()
    data.llm = settings
    this.persist()
  }

  setActiveModel(activeProviderId: string, activeModelId: string): void {
    const settings = this.getLlmSettings()
    settings.activeProviderId = activeProviderId
    settings.activeModelId = activeModelId
    this.setLlmSettings(settings)
  }

  private assertUnlocked(): void {
    if (!this.key || !this.data) {
      throw new Error('Vault is locked')
    }
  }

  private persist(saltOverride?: Buffer): void {
    this.assertUnlocked()
    const existingSalt = saltOverride
      ? saltOverride
      : Buffer.from((JSON.parse(readFileSync(this.filePath, 'utf8')) as VaultFile).salt, 'base64')

    const iv = randomBytes(12)
    const cipher = createCipheriv('aes-256-gcm', this.key as Buffer, iv)
    const plaintext = Buffer.from(JSON.stringify(this.data), 'utf8')
    const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()])
    const authTag = cipher.getAuthTag()

    const out: VaultFile = {
      version: 1,
      salt: existingSalt.toString('base64'),
      iv: iv.toString('base64'),
      authTag: authTag.toString('base64'),
      ciphertext: ciphertext.toString('base64')
    }

    mkdirSync(dirname(this.filePath), { recursive: true })
    writeFileSync(this.filePath, JSON.stringify(out))
  }

  // Hosts
  addHost(host: Omit<Host, 'id'>): Host {
    const data = this.getData()
    const newHost: Host = { ...host, id: randomUUID() }
    data.hosts.push(newHost)
    this.persist()
    return newHost
  }

  updateHost(id: string, patch: Partial<Host>): Host {
    const data = this.getData()
    const idx = data.hosts.findIndex((h) => h.id === id)
    if (idx === -1) throw new Error('Host not found')
    data.hosts[idx] = { ...data.hosts[idx], ...patch, id }
    this.persist()
    return data.hosts[idx]
  }

  deleteHost(id: string): void {
    const data = this.getData()
    data.hosts = data.hosts.filter((h) => h.id !== id)
    this.persist()
  }

  // Groups
  addGroup(group: Omit<Group, 'id'>): Group {
    const data = this.getData()
    const newGroup: Group = { ...group, id: randomUUID() }
    data.groups.push(newGroup)
    this.persist()
    return newGroup
  }

  updateGroup(id: string, patch: Partial<Group>): Group {
    const data = this.getData()
    const idx = data.groups.findIndex((g) => g.id === id)
    if (idx === -1) throw new Error('Group not found')
    data.groups[idx] = { ...data.groups[idx], ...patch, id }
    this.persist()
    return data.groups[idx]
  }

  deleteGroup(id: string): void {
    const data = this.getData()
    data.groups = data.groups.filter((g) => g.id !== id)
    data.hosts.forEach((h) => {
      if (h.groupId === id) h.groupId = null
    })
    this.persist()
  }

  // Credentials
  addCredential(cred: Omit<Credential, 'id'>): Credential {
    const data = this.getData()
    const newCred: Credential = { ...cred, id: randomUUID() }
    data.credentials.push(newCred)
    this.persist()
    return newCred
  }

  updateCredential(id: string, patch: Partial<Credential>): Credential {
    const data = this.getData()
    const idx = data.credentials.findIndex((c) => c.id === id)
    if (idx === -1) throw new Error('Credential not found')
    data.credentials[idx] = { ...data.credentials[idx], ...patch, id }
    this.persist()
    return data.credentials[idx]
  }

  deleteCredential(id: string): void {
    const data = this.getData()
    data.credentials = data.credentials.filter((c) => c.id !== id)
    data.hosts.forEach((h) => {
      if (h.credentialId === id) h.credentialId = null
    })
    this.persist()
  }

  // Import / Export

  /**
   * Produce a portable, password-encrypted export of all hosts, groups and
   * credentials (including their secrets). LLM settings are intentionally
   * excluded. Returns a JSON string safe to write to disk.
   */
  exportEncrypted(exportPassword: string): string {
    const data = this.getData()
    if (!exportPassword) throw new Error('导出密码不能为空')

    const payload: ExportPayload = {
      hosts: data.hosts,
      groups: data.groups,
      credentials: data.credentials
    }

    const salt = randomBytes(16)
    const key = scryptSync(exportPassword, salt, SCRYPT_KEYLEN, SCRYPT_OPTS)
    const iv = randomBytes(12)
    const cipher = createCipheriv('aes-256-gcm', key, iv)
    const plaintext = Buffer.from(JSON.stringify(payload), 'utf8')
    const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()])
    const authTag = cipher.getAuthTag()

    const file: VaultExportFile = {
      type: EXPORT_TYPE,
      version: 1,
      salt: salt.toString('base64'),
      iv: iv.toString('base64'),
      authTag: authTag.toString('base64'),
      ciphertext: ciphertext.toString('base64')
    }
    return JSON.stringify(file, null, 2)
  }

  /**
   * Decrypt an export file and merge its records into the current vault. All
   * ids are regenerated and internal references (parentId / groupId /
   * credentialId) are remapped, so importing never collides with or overwrites
   * existing entries.
   */
  importEncrypted(exportPassword: string, fileContent: string): VaultImportResult {
    this.assertUnlocked()

    let file: VaultExportFile
    try {
      file = JSON.parse(fileContent)
    } catch {
      throw new Error('无法解析导入文件')
    }
    if (!file || file.type !== EXPORT_TYPE) {
      throw new Error('文件格式不正确,不是有效的导出文件')
    }

    const salt = Buffer.from(file.salt, 'base64')
    const key = scryptSync(exportPassword, salt, SCRYPT_KEYLEN, SCRYPT_OPTS)
    const iv = Buffer.from(file.iv, 'base64')
    const authTag = Buffer.from(file.authTag, 'base64')
    const ciphertext = Buffer.from(file.ciphertext, 'base64')

    const decipher = createDecipheriv('aes-256-gcm', key, iv)
    decipher.setAuthTag(authTag)
    let plaintext: Buffer
    try {
      plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()])
    } catch {
      throw new Error('导入密码错误或文件已损坏')
    }

    const payload = JSON.parse(plaintext.toString('utf8')) as ExportPayload
    const importedGroups = payload.groups ?? []
    const importedCredentials = payload.credentials ?? []
    const importedHosts = payload.hosts ?? []

    const data = this.getData()

    const groupIdMap = new Map<string, string>()
    for (const g of importedGroups) groupIdMap.set(g.id, randomUUID())
    const credIdMap = new Map<string, string>()
    for (const c of importedCredentials) credIdMap.set(c.id, randomUUID())

    for (const g of importedGroups) {
      data.groups.push({
        ...g,
        id: groupIdMap.get(g.id) as string,
        parentId: g.parentId ? (groupIdMap.get(g.parentId) ?? null) : (g.parentId ?? null)
      })
    }
    for (const c of importedCredentials) {
      data.credentials.push({ ...c, id: credIdMap.get(c.id) as string })
    }
    for (const h of importedHosts) {
      data.hosts.push({
        ...h,
        id: randomUUID(),
        groupId: h.groupId ? (groupIdMap.get(h.groupId) ?? null) : (h.groupId ?? null),
        credentialId: h.credentialId
          ? (credIdMap.get(h.credentialId) ?? null)
          : (h.credentialId ?? null)
      })
    }

    this.persist()
    return {
      hosts: importedHosts.length,
      groups: importedGroups.length,
      credentials: importedCredentials.length
    }
  }
}

export const vaultManager = new VaultManager()
