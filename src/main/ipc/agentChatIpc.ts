import { ipcMain, app } from 'electron'
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync, unlinkSync } from 'fs'
import { join } from 'path'
import type { ChatMessage, AgentConversationMeta } from '../../shared/types'

export interface ConvFile {
  id: string
  hostId: string
  title: string
  updatedAt: number
  messages: ChatMessage[]
}

// hostId is a UUID, filesystem-safe — used directly as the directory name.
function dirFor(hostId: string): string {
  return join(app.getPath('userData'), 'agent-chats', hostId)
}

function listDir(hostId: string): AgentConversationMeta[] {
  const dir = dirFor(hostId)
  if (!existsSync(dir)) return []
  const metas: AgentConversationMeta[] = []
  for (const f of readdirSync(dir)) {
    if (!f.endsWith('.json')) continue
    try {
      const conv: ConvFile = JSON.parse(readFileSync(join(dir, f), 'utf8'))
      metas.push({
        id: conv.id,
        hostId: conv.hostId,
        title: conv.title,
        updatedAt: conv.updatedAt,
        messageCount: conv.messages.length
      })
    } catch {
      // skip corrupted file
    }
  }
  return metas
}

/** listAll 的上限:@ 菜单只需要最近的一批。 */
const LIST_ALL_CAP = 200

/** 跨目录列出所有会话(远程桌面智能体的会话也按 peerKey 存在这里),按更新时间倒序。 */
export function listAllConversations(cap = LIST_ALL_CAP): AgentConversationMeta[] {
  const root = join(app.getPath('userData'), 'agent-chats')
  if (!existsSync(root)) return []
  const all: AgentConversationMeta[] = []
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    if (entry.isDirectory()) all.push(...listDir(entry.name))
  }
  return all.sort((a, b) => b.updatedAt - a.updatedAt).slice(0, cap)
}

export function listHostConversations(hostId: string): AgentConversationMeta[] {
  return listDir(hostId).sort((a, b) => b.updatedAt - a.updatedAt)
}

/** 读一个会话文件;不存在、损坏或 id 不合法时返回 null。 */
export function loadConversation(hostId: string, convId: string): ConvFile | null {
  // id 可能来自外部(MCP),拒绝任何路径分隔符,防止读到 agent-chats 之外。
  if (/[\\/]|\.\./.test(hostId) || /[\\/]|\.\./.test(convId)) return null
  const file = join(dirFor(hostId), `${convId}.json`)
  if (!existsSync(file)) return null
  try {
    return JSON.parse(readFileSync(file, 'utf8')) as ConvFile
  } catch {
    return null
  }
}

export function registerAgentChatIpc(): void {
  ipcMain.handle('agentChat:list', (_e, hostId: string): AgentConversationMeta[] =>
    listHostConversations(hostId)
  )

  // 远程桌面智能体的会话由渲染层按主机库过滤掉。
  ipcMain.handle('agentChat:listAll', (): AgentConversationMeta[] => listAllConversations())

  ipcMain.handle('agentChat:load', (_e, hostId: string, convId: string): ChatMessage[] => {
    const file = join(dirFor(hostId), `${convId}.json`)
    if (!existsSync(file)) return []
    try {
      const conv: ConvFile = JSON.parse(readFileSync(file, 'utf8'))
      return conv.messages
    } catch {
      return []
    }
  })

  ipcMain.handle(
    'agentChat:save',
    (_e, hostId: string, convId: string, title: string, messages: ChatMessage[]) => {
      const dir = dirFor(hostId)
      mkdirSync(dir, { recursive: true })
      const conv: ConvFile = { id: convId, hostId, title, updatedAt: Date.now(), messages }
      writeFileSync(join(dir, `${convId}.json`), JSON.stringify(conv), 'utf8')
    }
  )

  ipcMain.handle('agentChat:remove', (_e, hostId: string, convId: string) => {
    const file = join(dirFor(hostId), `${convId}.json`)
    if (existsSync(file)) unlinkSync(file)
  })
}
