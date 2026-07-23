export interface Group {
  id: string
  name: string
  parentId?: string | null
}

/**
 * Payload for tearing a tab off into another window. `tab` is the renderer's `Tab`
 * object (all plain serializable data); it's typed loosely here so the main process
 * can route it without importing renderer code — the renderer casts back to `Tab`.
 * `cursor` is the drop point in screen coordinates, used to place/target the window.
 */
export interface AdoptPayload {
  tab: Record<string, unknown>
  cursor?: { x: number; y: number }
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

export type AttachmentKind = 'text' | 'pdf' | 'docx'

/**
 * A document the user attached to a message, already extracted to text.
 *
 * Only the bounded `preview` travels with the message (and into persistence) — the
 * full text stays in a renderer-side LRU keyed by `id`, and the model pulls more of
 * it on demand via `read_attachment`. That keeps a 50-page PDF out of both the
 * context window and the conversation JSON.
 */
export interface Attachment {
  id: string
  name: string
  kind: AttachmentKind
  /** Original file size in bytes. */
  size: number
  /** Total characters of extracted text (may exceed what `preview` holds). */
  chars: number
  /** PDF only. */
  pages?: number
  preview: string
  truncated: boolean
}

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool'
  content: string
  tool_calls?: ToolCall[]
  tool_call_id?: string
  /**
   * Images attached to a user message, as `data:image/...;base64,...` URLs. Kept
   * beside `content` so every consumer can keep treating content as plain text;
   * LlmClient folds them into OpenAI multimodal parts on the way out.
   */
  images?: string[]
  /**
   * Documents attached to a user message. Same deal as `images`: kept beside
   * `content`, folded into `<attachment>` envelopes by LlmClient on the way out.
   */
  attachments?: Attachment[]
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

/** 命令历史来源:用户手输 vs 智能体执行。 */
export type CommandSource = 'user' | 'agent'

/** 一条本地持久化的命令历史,按服务器(hostId)归档。 */
export interface CommandHistoryEntry {
  /** 稳定唯一键,供删除单条使用(时间戳可能碰撞,故不以它作删除键)。 */
  id: string
  command: string
  /** Date.now() at capture。 */
  timestamp: number
  source: CommandSource
}

/**
 * 一条用户自定义的「快捷命令」:保存一批命令,一键写入终端执行。
 * hostId 有值 → 绑定该服务器(点击时新开标签并连接);为空/未设 → 在当前活跃终端执行。
 */
export interface QuickCommand {
  id: string
  title: string
  description: string
  /** 原始多行文本(一批命令,按行执行)。 */
  commands: string
  /** 绑定的服务器 vault id;为空/null 表示不绑定,在当前终端执行。 */
  hostId?: string | null
  /** Date.now() at creation。 */
  createdAt: number
}

/**
 * runInShell 的终局状态,取代过去仅有的 timedOut 布尔:
 * - completed:   命令正常跑完,exitCode 有效。
 * - interrupted: 命令超时/静默/疑似等待输入,系统已自动中断并夺回提示符(终端仍可用)。
 * - stuck:       连按键升级(Ctrl-C/Ctrl-Z 等)都无法恢复,建议断开重连该终端。
 */
export type ShellRunState = 'completed' | 'interrupted' | 'stuck'

export interface RunShellResult {
  output: string
  exitCode: number | null
  timedOut: boolean
  state: ShellRunState
  /** 面向模型的可读诊断/恢复说明(为何中断、如何恢复、是否疑似等待输入等)。 */
  note?: string
}

export interface SshConnectOptions {
  sessionId: string
  host: string
  port: number
  username: string
  password?: string
  privateKey?: string
  passphrase?: string
  /** 有值时:不开登录 shell,改为在 exec 通道上以 PTY 运行该命令(容器终端等)。 */
  execCommand?: string
}

/** 容器文件浏览会话(SSH 到宿主机后,经 docker exec / docker cp 操作容器内文件)。 */
export interface ContainerFsConnectOptions extends SshConnectOptions {
  containerId: string
  /** 'docker' 或 'sudo -n docker' —— 由渲染进程探测得出。 */
  dockerCmd: string
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

/**
 * Dry-run result for a transfer: what a recursive copy *would* move.
 * Symlinks are skipped by the scanners, so they are excluded here too.
 */
export interface TransferPlan {
  totalFiles: number
  totalBytes: number
}

/** Persisted, non-sensitive app preferences (stored unencrypted, outside the vault). */
export interface AppSettings {
  /** Concurrent in-flight SFTP packets per file for fastGet/fastPut transfers. */
  transferConcurrency: number
}

export const DEFAULT_TRANSFER_CONCURRENCY = 64
export const MIN_TRANSFER_CONCURRENCY = 1
export const MAX_TRANSFER_CONCURRENCY = 256

export const DEFAULT_APP_SETTINGS: AppSettings = {
  transferConcurrency: DEFAULT_TRANSFER_CONCURRENCY
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
