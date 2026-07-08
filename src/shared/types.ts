export interface Group {
  id: string
  name: string
  parentId?: string | null
}

export interface Credential {
  id: string
  name: string
  type: 'password' | 'key'
  username?: string
  password?: string
  privateKey?: string
  passphrase?: string
}

export interface Host {
  id: string
  label: string
  address: string
  port: number
  username: string
  groupId?: string | null
  credentialId?: string | null
  tags?: string[]
  authType: 'password' | 'key' | 'credential'
  password?: string
  privateKey?: string
  passphrase?: string
}

export interface LlmModel {
  id: string
  name: string // model string sent to the API, e.g. "gpt-4o-mini"
  label?: string // optional display name
  contextWindow?: number // 上下文窗口 token 上限;未设置时由模型名推断
}

export interface LlmProvider {
  id: string
  name: string // display name, e.g. "DeepSeek"
  baseUrl: string
  apiKey: string
  models: LlmModel[]
}

export interface LlmSettings {
  providers: LlmProvider[]
  activeProviderId?: string
  activeModelId?: string
}

// Renderer-facing variants that never carry the plaintext key.
export interface LlmProviderPublic {
  id: string
  name: string
  baseUrl: string
  models: LlmModel[]
  hasKey: boolean
}
export interface LlmSettingsPublic {
  providers: LlmProviderPublic[]
  activeProviderId?: string
  activeModelId?: string
}

// Legacy single-config shape kept only for migration.
export interface LlmConfigLegacy {
  baseUrl: string
  apiKey: string
  model: string
}

export interface VaultData {
  hosts: Host[]
  groups: Group[]
  credentials: Credential[]
  llm?: LlmSettings | LlmConfigLegacy
}

/** Number of records merged in by an import operation. */
export interface VaultImportResult {
  hosts: number
  groups: number
  credentials: number
}

export interface ToolCall {
  id: string
  type: 'function'
  function: { name: string; arguments: string }
}

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool'
  content: string
  tool_calls?: ToolCall[]
  tool_call_id?: string
}

// tool/function definition sent to the LLM (OpenAI format)
export interface ChatTool {
  type: 'function'
  function: {
    name: string
    description: string
    parameters: Record<string, unknown>
  }
}

export interface AgentConversationMeta {
  id: string
  hostId: string
  title: string
  updatedAt: number
  messageCount: number
}

export interface RunShellResult {
  output: string
  exitCode: number | null
  timedOut: boolean
}

export interface SshConnectOptions {
  sessionId: string
  host: string
  port: number
  username: string
  password?: string
  privateKey?: string
  passphrase?: string
}

export interface SftpListEntry {
  name: string
  path: string
  type: 'file' | 'directory' | 'symlink' | 'other'
  size: number
  modifyTime: number
  permissions: string
}

export interface LocalListEntry {
  name: string
  path: string
  type: 'file' | 'directory' | 'symlink' | 'other'
  size: number
  modifyTime: number
}

/** Progress for a recursive file transfer (upload/download/copy/cross-host). */
export interface TransferProgress {
  transferId: string
  phase: 'scan' | 'transfer' | 'done' | 'error'
  currentPath?: string
  doneBytes: number
  totalBytes: number
  doneFiles: number
  totalFiles: number
  error?: string
}

export interface HistoryVersion {
  id: string
  label: string
  mtime: number
}

export interface HistoryDocument {
  fileKey: string
  hostId: string
  remotePath: string
  fileName: string
  versionCount: number
  updatedAt: number
}
