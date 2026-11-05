import { ipcMain, app } from 'electron'
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync, unlinkSync } from 'fs'
import { join } from 'path'
import type { ChatMessage, AgentConversationMeta } from '../../shared/types'

interface ConvFile {
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

export function registerAgentChatIpc(): void {
  ipcMain.handle('agentChat:list', (_e, hostId: string): AgentConversationMeta[] =>
    listDir(hostId).sort((a, b) => b.updatedAt - a.updatedAt)
  )

  // 跨目录列出所有会话。远程桌面智能体的会话也按 peerKey 存在这里,由渲染层按主机库过滤掉。
  ipcMain.handle('agentChat:listAll', (): AgentConversationMeta[] => {
    const root = join(app.getPath('userData'), 'agent-chats')
    if (!existsSync(root)) return []
    const all: AgentConversationMeta[] = []
    for (const entry of readdirSync(root, { withFileTypes: true })) {
      if (entry.isDirectory()) all.push(...listDir(entry.name))
    }
    return all.sort((a, b) => b.updatedAt - a.updatedAt).slice(0, LIST_ALL_CAP)
  })

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
