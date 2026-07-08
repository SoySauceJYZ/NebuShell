import { contextBridge, ipcRenderer, clipboard, webUtils } from 'electron'
import { electronAPI } from '@electron-toolkit/preload'
import type {
  Host,
  Group,
  Credential,
  VaultImportResult,
  SshConnectOptions,
  SftpListEntry,
  LocalListEntry,
  TransferProgress,
  HistoryVersion,
  HistoryDocument,
  ChatMessage,
  ChatTool,
  RunShellResult,
  LlmSettings,
  LlmSettingsPublic,
  AgentConversationMeta
} from '../shared/types'

const api = {
  clipboard: {
    writeText: (text: string): void => clipboard.writeText(text),
    readText: (): string => clipboard.readText()
  },
  os: {
    // Electron 39 removed File.path; webUtils is the only way to resolve a dropped
    // File to an absolute disk path. Returns '' for non-disk (synthetic) files.
    getPathForFile: (file: File): string => webUtils.getPathForFile(file)
  },
  file: {
    saveText: (defaultName: string, content: string): Promise<string | null> =>
      ipcRenderer.invoke('file:saveText', defaultName, content)
  },
  window: {
    minimize: () => ipcRenderer.invoke('window:minimize'),
    toggleMaximize: (): Promise<boolean> => ipcRenderer.invoke('window:toggleMaximize'),
    close: () => ipcRenderer.invoke('window:close'),
    isMaximized: (): Promise<boolean> => ipcRenderer.invoke('window:isMaximized'),
    onMaximizeChanged: (cb: (maximized: boolean) => void): (() => void) => {
      const listener = (_e: unknown, maximized: boolean): void => cb(maximized)
      ipcRenderer.on('window:maximizeChanged', listener)
      ipcRenderer.send('window:subscribeMaximize')
      return () => ipcRenderer.removeListener('window:maximizeChanged', listener)
    }
  },
  vault: {
    isInitialized: (): Promise<boolean> => ipcRenderer.invoke('vault:isInitialized'),
    isUnlocked: (): Promise<boolean> => ipcRenderer.invoke('vault:isUnlocked'),
    create: (masterPassword: string) => ipcRenderer.invoke('vault:create', masterPassword),
    unlock: (masterPassword: string) => ipcRenderer.invoke('vault:unlock', masterPassword),
    lock: () => ipcRenderer.invoke('vault:lock'),
    getData: () => ipcRenderer.invoke('vault:getData'),

    addHost: (host: Omit<Host, 'id'>): Promise<Host> => ipcRenderer.invoke('vault:host:add', host),
    updateHost: (id: string, patch: Partial<Host>): Promise<Host> =>
      ipcRenderer.invoke('vault:host:update', id, patch),
    deleteHost: (id: string): Promise<void> => ipcRenderer.invoke('vault:host:delete', id),

    addGroup: (group: Omit<Group, 'id'>): Promise<Group> =>
      ipcRenderer.invoke('vault:group:add', group),
    updateGroup: (id: string, patch: Partial<Group>): Promise<Group> =>
      ipcRenderer.invoke('vault:group:update', id, patch),
    deleteGroup: (id: string): Promise<void> => ipcRenderer.invoke('vault:group:delete', id),

    addCredential: (cred: Omit<Credential, 'id'>): Promise<Credential> =>
      ipcRenderer.invoke('vault:credential:add', cred),
    updateCredential: (id: string, patch: Partial<Credential>): Promise<Credential> =>
      ipcRenderer.invoke('vault:credential:update', id, patch),
    deleteCredential: (id: string): Promise<void> =>
      ipcRenderer.invoke('vault:credential:delete', id),

    exportData: (password: string): Promise<string | null> =>
      ipcRenderer.invoke('vault:export', password),
    importPickFile: (): Promise<string | null> => ipcRenderer.invoke('vault:import:pickFile'),
    importApply: (password: string, content: string): Promise<VaultImportResult> =>
      ipcRenderer.invoke('vault:import:apply', password, content)
  },
  ssh: {
    connect: (opts: SshConnectOptions): Promise<void> => ipcRenderer.invoke('ssh:connect', opts),
    write: (sessionId: string, data: string) => ipcRenderer.invoke('ssh:write', sessionId, data),
    resize: (sessionId: string, cols: number, rows: number) =>
      ipcRenderer.invoke('ssh:resize', sessionId, cols, rows),
    exec: (sessionId: string, command: string): Promise<string> =>
      ipcRenderer.invoke('ssh:exec', sessionId, command),
    runInShell: (sessionId: string, command: string): Promise<RunShellResult> =>
      ipcRenderer.invoke('ssh:runInShell', sessionId, command),
    disconnect: (sessionId: string) => ipcRenderer.invoke('ssh:disconnect', sessionId),
    onData: (sessionId: string, cb: (data: string) => void): (() => void) => {
      const channel = `ssh:data:${sessionId}`
      const listener = (_e: unknown, data: string): void => cb(data)
      ipcRenderer.on(channel, listener)
      return () => ipcRenderer.removeListener(channel, listener)
    },
    onClosed: (sessionId: string, cb: () => void): (() => void) => {
      const channel = `ssh:closed:${sessionId}`
      const listener = (): void => cb()
      ipcRenderer.on(channel, listener)
      return () => ipcRenderer.removeListener(channel, listener)
    },
    onError: (sessionId: string, cb: (message: string) => void): (() => void) => {
      const channel = `ssh:error:${sessionId}`
      const listener = (_e: unknown, message: string): void => cb(message)
      ipcRenderer.on(channel, listener)
      return () => ipcRenderer.removeListener(channel, listener)
    }
  },
  sftp: {
    connect: (opts: SshConnectOptions): Promise<void> => ipcRenderer.invoke('sftp:connect', opts),
    list: (sessionId: string, path: string): Promise<SftpListEntry[]> =>
      ipcRenderer.invoke('sftp:list', sessionId, path),
    mkdir: (sessionId: string, path: string): Promise<void> =>
      ipcRenderer.invoke('sftp:mkdir', sessionId, path),
    readFile: (sessionId: string, remotePath: string): Promise<string> =>
      ipcRenderer.invoke('sftp:readFile', sessionId, remotePath),
    writeFile: (sessionId: string, remotePath: string, content: string): Promise<void> =>
      ipcRenderer.invoke('sftp:writeFile', sessionId, remotePath, content),
    rename: (sessionId: string, oldPath: string, newPath: string): Promise<void> =>
      ipcRenderer.invoke('sftp:rename', sessionId, oldPath, newPath),
    remove: (sessionId: string, path: string, isDirectory: boolean): Promise<void> =>
      ipcRenderer.invoke('sftp:remove', sessionId, path, isDirectory),
    download: (sessionId: string, remotePath: string): Promise<string | null> =>
      ipcRenderer.invoke('sftp:download', sessionId, remotePath),
    upload: (sessionId: string, remoteDir: string): Promise<string | null> =>
      ipcRenderer.invoke('sftp:upload', sessionId, remoteDir),
    // Recursive upload of explicit local paths (from drag-drop / local pane) with progress.
    uploadPaths: (
      sessionId: string,
      remoteDir: string,
      localPaths: string[],
      transferId: string
    ): Promise<void> =>
      ipcRenderer.invoke('sftp:uploadPaths', sessionId, remoteDir, localPaths, transferId),
    // Recursive download of a remote path into an explicit local directory.
    downloadTo: (
      sessionId: string,
      remotePath: string,
      localDir: string,
      transferId: string
    ): Promise<void> =>
      ipcRenderer.invoke('sftp:downloadTo', sessionId, remotePath, localDir, transferId),
    // Cross-host remote -> remote transfer (streamed in the main process).
    transfer: (
      srcSessionId: string,
      srcPath: string,
      dstSessionId: string,
      dstDir: string,
      transferId: string
    ): Promise<void> =>
      ipcRenderer.invoke('sftp:transfer', srcSessionId, srcPath, dstSessionId, dstDir, transferId),
    // Native drag-out to the OS file manager (fire-and-forget).
    startDrag: (sessionId: string, remotePath: string, name: string): void =>
      ipcRenderer.send('sftp:startDrag', sessionId, remotePath, name),
    disconnect: (sessionId: string) => ipcRenderer.invoke('sftp:disconnect', sessionId)
  },
  local: {
    home: (): Promise<string> => ipcRenderer.invoke('local:home'),
    drives: (): Promise<string[]> => ipcRenderer.invoke('local:drives'),
    list: (dir: string): Promise<LocalListEntry[]> => ipcRenderer.invoke('local:list', dir),
    stat: (
      p: string
    ): Promise<{ type: LocalListEntry['type']; size: number; modifyTime: number }> =>
      ipcRenderer.invoke('local:stat', p),
    mkdir: (p: string): Promise<void> => ipcRenderer.invoke('local:mkdir', p),
    rename: (oldPath: string, newPath: string): Promise<void> =>
      ipcRenderer.invoke('local:rename', oldPath, newPath),
    remove: (p: string, isDirectory: boolean): Promise<void> =>
      ipcRenderer.invoke('local:remove', p, isDirectory),
    readFile: (p: string): Promise<string> => ipcRenderer.invoke('local:readFile', p),
    writeFile: (p: string, content: string): Promise<void> =>
      ipcRenderer.invoke('local:writeFile', p, content),
    readFileBase64: (p: string): Promise<{ base64: string; mime: string }> =>
      ipcRenderer.invoke('local:readFileBase64', p),
    copy: (src: string, dstDir: string, transferId: string): Promise<void> =>
      ipcRenderer.invoke('local:copy', src, dstDir, transferId),
    pickDir: (): Promise<string | null> => ipcRenderer.invoke('local:pickDir')
  },
  transfers: {
    // Subscribe to progress for one transferId (covers both sftp:* and local:* streams).
    onProgress: (transferId: string, cb: (p: TransferProgress) => void): (() => void) => {
      const ch1 = `sftp:progress:${transferId}`
      const ch2 = `local:progress:${transferId}`
      const listener = (_e: unknown, p: TransferProgress): void => cb(p)
      ipcRenderer.on(ch1, listener)
      ipcRenderer.on(ch2, listener)
      return () => {
        ipcRenderer.removeListener(ch1, listener)
        ipcRenderer.removeListener(ch2, listener)
      }
    }
  },
  history: {
    save: (fileKey: string, content: string, fileName?: string): Promise<HistoryVersion> =>
      ipcRenderer.invoke('history:save', fileKey, content, fileName),
    list: (fileKey: string): Promise<HistoryVersion[]> =>
      ipcRenderer.invoke('history:list', fileKey),
    read: (fileKey: string, id: string): Promise<string> =>
      ipcRenderer.invoke('history:read', fileKey, id),
    listAll: (): Promise<HistoryDocument[]> => ipcRenderer.invoke('history:listAll')
  },
  dialog: {
    confirm: (opts: {
      message: string
      detail?: string
      confirmLabel?: string
      cancelLabel?: string
    }): Promise<boolean> => ipcRenderer.invoke('dialog:confirm', opts)
  },
  agentChat: {
    list: (hostId: string): Promise<AgentConversationMeta[]> =>
      ipcRenderer.invoke('agentChat:list', hostId),
    load: (hostId: string, convId: string): Promise<ChatMessage[]> =>
      ipcRenderer.invoke('agentChat:load', hostId, convId),
    save: (hostId: string, convId: string, title: string, messages: ChatMessage[]): Promise<void> =>
      ipcRenderer.invoke('agentChat:save', hostId, convId, title, messages),
    remove: (hostId: string, convId: string): Promise<void> =>
      ipcRenderer.invoke('agentChat:remove', hostId, convId)
  },
  llm: {
    getSettings: (): Promise<LlmSettingsPublic> => ipcRenderer.invoke('llm:getSettings'),
    setSettings: (settings: LlmSettings): Promise<LlmSettingsPublic> =>
      ipcRenderer.invoke('llm:setSettings', settings),
    setActive: (providerId: string, modelId: string): Promise<void> =>
      ipcRenderer.invoke('llm:setActive', providerId, modelId),
    chat: (
      runId: string,
      payload: { messages: ChatMessage[]; tools: ChatTool[]; providerId?: string; model?: string }
    ): Promise<void> => ipcRenderer.invoke('llm:chat', runId, payload),
    abort: (runId: string): Promise<void> => ipcRenderer.invoke('llm:abort', runId),
    onDelta: (runId: string, cb: (text: string) => void): (() => void) => {
      const channel = `llm:delta:${runId}`
      const listener = (_e: unknown, text: string): void => cb(text)
      ipcRenderer.on(channel, listener)
      return () => ipcRenderer.removeListener(channel, listener)
    },
    onDone: (runId: string, cb: (message: ChatMessage) => void): (() => void) => {
      const channel = `llm:done:${runId}`
      const listener = (_e: unknown, message: ChatMessage): void => cb(message)
      ipcRenderer.on(channel, listener)
      return () => ipcRenderer.removeListener(channel, listener)
    },
    onError: (runId: string, cb: (message: string) => void): (() => void) => {
      const channel = `llm:error:${runId}`
      const listener = (_e: unknown, message: string): void => cb(message)
      ipcRenderer.on(channel, listener)
      return () => ipcRenderer.removeListener(channel, listener)
    }
  }
}

export type Api = typeof api

if (process.contextIsolated) {
  try {
    contextBridge.exposeInMainWorld('electron', electronAPI)
    contextBridge.exposeInMainWorld('api', api)
  } catch (error) {
    console.error(error)
  }
} else {
  // @ts-ignore (define in dts)
  window.electron = electronAPI
  // @ts-ignore (define in dts)
  window.api = api
}
